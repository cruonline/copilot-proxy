import { ServerResponse } from 'node:http';
import { Collector } from './collector';
import { InferenceEvent } from './types';
import { checkAbort } from './errors';
/** Backpressure and cancellation are shared by all three streaming formats. */
export async function write(res: ServerResponse, data: string | Uint8Array, signal: AbortSignal): Promise<void> {
    checkAbort(signal);
    if (res.destroyed)
        throw new Error('Connection closed');
    if (res.write(data))
        return;
    await new Promise<void>((resolve, reject) => {
        const cleanup = () => { res.off('drain', drain); res.off('error', error); res.off('close', closed); signal.removeEventListener('abort', aborted); };
        const drain = () => { cleanup(); resolve(); };
        const error = (e: Error) => { cleanup(); reject(e); };
        const closed = () => error(new Error('Connection closed'));
        const aborted = () => error(signal.reason ?? new Error('Cancelled'));
        res.once('drain', drain);
        res.once('error', error);
        res.once('close', closed);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted)
            aborted();
    });
}
export class WireStream {
    private seq = 0;
    private started = new Set<string>();
    private sent = new Map<string, number>();
    constructor(private res: ServerResponse, public c: Collector, private signal: AbortSignal) { }
    private send(event: string, data: any): Promise<void> {
        const body = this.c.turn.protocol === 'responses' ? { ...data, type: event, sequence_number: this.seq++ } : data;
        return write(this.res, `${event ? 'event: ' + event + '\n' : ''}data: ${JSON.stringify(body)}\n\n`, this.signal);
    }
    private chat(delta: any, finish: any = null, usage?: any): Promise<void> {
        if(this.c.turn.protocol==='completion')return this.send('',{id:this.c.id,object:'text_completion',created:this.c.created,model:this.c.turn.model,choices:[{index:0,text:delta.content??'',finish_reason:finish,logprobs:null}],...(usage?{usage}:{})});
        return this.send('', { id: this.c.id, object: 'chat.completion.chunk', created: this.c.created, model: this.c.turn.model, choices: usage ? [] : [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });
    }
    async start(): Promise<void> {
        const p = this.c.turn.protocol;
        if (p === 'chat' || p === 'completion')
            await this.chat({ role: 'assistant', content: '' });
        else if (p === 'messages')
            await this.send('message_start', { type: 'message_start', message: { id: this.c.id, type: 'message', role: 'assistant', model: this.c.turn.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
        else {
            const response = { ...this.c.json(), status: 'in_progress', usage: null };
            await this.send('response.created', { response });
            await this.send('response.in_progress', { response });
        }
    }
    async consume(e: InferenceEvent): Promise<void> {
        const change = this.c.consume(e);
        const item = change.item;
        if (!item)
            return;
        const p = this.c.turn.protocol;
        const index = this.c.output.indexOf(item);
        // Anthropic content blocks are sequential. Buffer parallel tool arguments, then
        // emit each complete tool block at the end instead of interleaving open blocks.
        if (p === 'messages') {
            if (item.kind !== 'text' || this.c.output.some(o => o.kind === 'tool'))
                return;
            if (!this.started.has(item.id)) {
                this.started.add(item.id);
                await this.send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
            }
            await this.send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: change.delta } });
            this.sent.set(item.id, item.text.length);
            return;
        }
        // Wait for a complete declared tool name; upstream may fragment the name.
        if (item.kind === 'tool' && !this.c.turn.tools.some(t => t.name === item.name))
            return;
        const first = !this.started.has(item.id);
        this.started.add(item.id);
        if (p === 'chat' || p === 'completion') {
            if (item.kind === 'text')
                await this.chat({ content: change.delta });
            else {
                const offset = this.sent.get(item.id) ?? 0;
                await this.chat({ tool_calls: [{ index: item.index, ...(first ? { id: item.callId, type: 'function', function: { name: item.name, arguments: item.arguments.slice(offset) } } : { function: { arguments: item.arguments.slice(offset) } }) }] });
                this.sent.set(item.id, item.arguments.length);
            }
            return;
        }
        if (first) {
            {
                const wire = this.c.wireItem(item);
                if (item.kind === 'text')
                    wire.content = [];
                else if (item.custom)
                    wire.input = '';
                else
                    wire.arguments = '';
                wire.status = 'in_progress';
                await this.send('response.output_item.added', { output_index: index, item: wire });
                if (item.kind === 'text')
                    await this.send('response.content_part.added', { item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
            }
        }
        if (item.kind === 'text') {
            await this.send('response.output_text.delta', { item_id: item.id, output_index: index, content_index: 0, delta: change.delta });
        }
        else if (!item.custom) {
            const offset = this.sent.get(item.id) ?? 0;
            const delta = item.arguments.slice(offset);
            if (delta)
                await this.send('response.function_call_arguments.delta', { item_id: item.id, output_index: index, delta });
            this.sent.set(item.id, item.arguments.length);
        }
    }
    async complete(): Promise<void> {
        this.c.complete();
        const p = this.c.turn.protocol;
        const usage = this.c.usage!;
        if (p === 'chat' || p === 'completion') {
            await this.chat({}, this.c.finish);
            await this.chat({}, null, { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output });
            await write(this.res, 'data: [DONE]\n\n', this.signal);
            return;
        }
        for (const [index, item] of this.c.output.entries()) {
            if (p === 'messages') {
                if (!this.started.has(item.id))
                    await this.send('content_block_start', { type: 'content_block_start', index, content_block: item.kind === 'text' ? { type: 'text', text: '' } : { type: 'tool_use', id: item.callId, name: item.name, input: {} } });
                if (item.kind === 'tool')
                    await this.send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: item.arguments } });
                else {
                    const delta = item.text.slice(this.sent.get(item.id) ?? 0);
                    if (delta)
                        await this.send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: delta } });
                }
                await this.send('content_block_stop', { type: 'content_block_stop', index });
                continue;
            }
            if (item.kind === 'text') {
                await this.send('response.output_text.done', { item_id: item.id, output_index: index, content_index: 0, text: item.text });
                await this.send('response.content_part.done', { item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: item.text, annotations: [] } });
            }
            else if (item.custom) {
                const input = this.c.customInput(item);
                await this.send('response.custom_tool_call_input.delta', { item_id: item.id, output_index: index, delta: input });
                await this.send('response.custom_tool_call_input.done', { item_id: item.id, output_index: index, input });
            }
            else
                await this.send('response.function_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
            await this.send('response.output_item.done', { output_index: index, item: this.c.wireItem(item) });
        }
        if (p === 'messages') {
            const json = this.c.json();
            await this.send('message_delta', { type: 'message_delta', delta: { stop_reason: json.stop_reason, stop_sequence: null }, usage: { input_tokens: usage.input, output_tokens: usage.output } });
            await this.send('message_stop', { type: 'message_stop' });
        }
        else {
            const response = this.c.json();
            await this.send(response.status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response });
        }
    }
    async error(message: string, type: string, signal?: AbortSignal): Promise<void> {
        if (signal) this.signal = signal;
        const p = this.c.turn.protocol;
        if (p === 'responses')
            await this.send('response.failed', { response: { ...this.c.json(), status: 'failed', error: { code: type, message }, usage: null } });
        else
            await this.send(p === 'messages' ? 'error' : '', { ...(p === 'messages' ? { type: 'error' } : {}), error: { type, message } });
    }
}
