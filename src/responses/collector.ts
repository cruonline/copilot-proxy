import { randomUUID } from 'node:crypto';
import { Finish, InferenceEvent, Turn, Usage } from './types';
import { ProxyError } from './errors';
import { estimatedInput } from './normalize';
export type Output = {
    kind: 'text';
    id: string;
    text: string;
} | {
    kind: 'tool';
    id: string;
    callId: string;
    name: string;
    arguments: string;
    custom: boolean;
    index: number;
};
export class Collector {
    readonly id = 'resp_' + randomUUID().replaceAll('-', '');
    readonly created = Math.floor(Date.now() / 1000);
    output: Output[] = [];
    usage?: Usage;
    finish?: Finish;
    private bytes = 0;
    constructor(public turn: Turn, private maxBytes = 16 * 1024 * 1024) { }
    consume(e: InferenceEvent): {
        item?: Output;
        added?: boolean;
        delta?: string;
    } {
        if (e.kind === 'usage') {
            if (![e.usage.input, e.usage.output, e.usage.cached ?? 0, e.usage.reasoning ?? 0].every(n => Number.isSafeInteger(n) && n >= 0))
                throw new ProxyError(502, 'Invalid upstream usage.', 'upstream_error');
            this.usage = e.usage;
            return {};
        }
        if (e.kind === 'finish') {
            this.finish = e.reason;
            return {};
        }
        this.bytes += Buffer.byteLength(e.kind === 'text' ? e.text : (e.arguments ?? '') + (e.name ?? ''));
        if (this.bytes > this.maxBytes)
            throw new ProxyError(502, 'Upstream output exceeds 16 MiB limit.', 'upstream_error');
        if (e.kind === 'text') {
            const last = this.output.at(-1);
            const added = last?.kind !== 'text';
            const item = !added ? last : { kind: 'text' as const, id: 'msg_' + randomUUID().replaceAll('-', ''), text: '' };
            if (item.kind !== 'text')
                throw new Error('Invalid collector state');
            if (added)
                this.output.push(item);
            item.text += e.text;
            return { item, added, delta: e.text };
        }
        if (!Number.isSafeInteger(e.index) || e.index < 0 || e.index > 1024)
            throw new ProxyError(502, 'Invalid upstream tool index.', 'upstream_error');
        let item = this.output.find((i): i is Extract<Output, {
            kind: 'tool';
        }> => i.kind === 'tool' && i.index === e.index);
        const added = !item;
        if (!item) {
            item = { kind: 'tool', id: 'fc_' + randomUUID().replaceAll('-', ''), callId: e.id ?? 'call_' + randomUUID().replaceAll('-', ''), name: '', arguments: '', custom: false, index: e.index };
            this.output.push(item);
        }
        if (e.id && e.id !== item.callId)
            throw new ProxyError(502, 'Upstream changed a tool-call ID.', 'upstream_error');
        if (e.name)
            item.name += e.name;
        item.custom = this.turn.tools.find(t => t.name === item.name)?.custom ?? false;
        item.arguments += e.arguments ?? '';
        return { item, added, delta: e.arguments ?? '' };
    }
    complete(): void {
        if (!this.finish)
            throw new ProxyError(502, 'Upstream ended without a completion marker.', 'upstream_error');
        for (const o of this.output)
            if (o.kind === 'tool') {
                if (!this.turn.tools.some(t => t.name === o.name))
                    throw new ProxyError(502, 'Upstream requested an undeclared tool.', 'upstream_error');
                let args: unknown;
                try {
                    args = JSON.parse(o.arguments);
                }
                catch {
                    throw new ProxyError(502, 'Upstream returned incomplete tool arguments.', 'upstream_error');
                }
                if (!args || typeof args !== 'object' || Array.isArray(args) || (o.custom && typeof (args as any).input !== 'string'))
                    throw new ProxyError(502, 'Upstream returned invalid tool arguments.', 'upstream_error');
            }
        if (this.output.some(o => o.kind === 'tool') && this.finish === 'stop')
            this.finish = 'tool_calls';
        if (!this.usage)
            this.usage = { input: estimatedInput(this.turn), output: Math.ceil(this.bytes / 4), estimated: true };
    }
    wireItem(item: Output): any {
        if (item.kind === 'text')
            return { id: item.id, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] };
        const tool = this.turn.tools.find(t => t.name === item.name);
        const identity = { name: tool?.wireName ?? item.name, ...(tool?.namespace ? { namespace: tool.namespace } : {}) };
        if (item.custom)
            return { id: item.id, type: 'custom_tool_call', call_id: item.callId, ...identity, input: this.customInput(item), status: 'completed' };
        return { id: item.id, type: 'function_call', call_id: item.callId, ...identity, arguments: item.arguments, status: 'completed' };
    }
    customInput(item: Extract<Output, {
        kind: 'tool';
    }>): string {
        try {
            const a = JSON.parse(item.arguments);
            return typeof a.input === 'string' ? a.input : '';
        }
        catch {
            return '';
        }
    }
    json(): any {
        const usage = this.usage ?? { input: 0, output: 0, estimated: true };
        const toolCalls = this.output.filter((o): o is Extract<Output, {
            kind: 'tool';
        }> => o.kind === 'tool');
        if(this.turn.protocol==='completion')return {id:this.id,object:'text_completion',created:this.created,model:this.turn.model,choices:[{index:0,text:this.output.filter(o=>o.kind==='text').map(o=>o.text).join(''),finish_reason:this.finish,logprobs:null}],usage:{prompt_tokens:usage.input,completion_tokens:usage.output,total_tokens:usage.input+usage.output},proxy:{usage_estimated:usage.estimated,warnings:this.turn.warnings}};
        if (this.turn.protocol === 'chat')
            return { id: this.id, object: 'chat.completion', created: this.created, model: this.turn.model, choices: [{ index: 0, message: { role: 'assistant', content: this.output.filter(o => o.kind === 'text').map(o => o.text).join('') || null, ...(toolCalls.length ? { tool_calls: toolCalls.map(o => ({ id: o.callId, type: 'function', function: { name: o.name, arguments: o.arguments } })) } : {}) }, finish_reason: this.finish }], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output }, proxy: { usage_estimated: usage.estimated, warnings: this.turn.warnings, tool_calls_executed:this.turn.toolCallsExecuted } };
        if (this.turn.protocol === 'messages')
            return { id: this.id, type: 'message', role: 'assistant', model: this.turn.model, content: this.output.map(o => o.kind === 'text' ? { type: 'text', text: o.text } : { type: 'tool_use', id: o.callId, name: o.name, input: JSON.parse(o.arguments || '{}') }), stop_reason: this.finish === 'tool_calls' ? 'tool_use' : this.finish === 'length' ? 'max_tokens' : this.finish === 'content_filter' ? 'refusal' : 'end_turn', stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: usage.cached ?? 0 }, proxy: { usage_estimated: usage.estimated, warnings: this.turn.warnings, tool_calls_executed:this.turn.toolCallsExecuted } };
        return { id: this.id, object: 'response', created_at: this.created, status: this.finish === 'length' || this.finish === 'content_filter' ? 'incomplete' : 'completed', error: null, incomplete_details: this.finish === 'length' ? { reason: 'max_output_tokens' } : this.finish === 'content_filter' ? { reason: 'content_filter' } : null, model: this.turn.model, output: this.output.map(o => this.wireItem(o)), parallel_tool_calls: true, tool_choice: this.turn.choice, tools: [], store: false, previous_response_id: null, usage: { input_tokens: usage.input, input_tokens_details: { cached_tokens: usage.cached ?? 0 }, output_tokens: usage.output, output_tokens_details: { reasoning_tokens: usage.reasoning ?? 0 }, total_tokens: usage.input + usage.output }, proxy: { usage_estimated: usage.estimated, warnings: this.turn.warnings, tool_calls_executed:this.turn.toolCallsExecuted } };
    }
}
