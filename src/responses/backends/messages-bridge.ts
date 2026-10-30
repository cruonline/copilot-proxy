import { InferenceEvent, Turn, ValuePart } from '../types';
import { checkAbort, ProxyError } from '../errors';
import { parseSSE } from '../sse';

/** Translate complete Responses history for models which only expose /messages. */
export function messagesRequest(turn: Turn): Record<string, unknown> {
    const value = (p: ValuePart) => p.kind === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } };
    const system: unknown[] = [];
    const messages: Array<{ role: string; content: unknown[] }> = [];
    for (const message of turn.messages) {
        if (message.role === 'system') { system.push(...message.parts.filter(p => p.kind === 'text').map(value)); continue; }
        const content = message.parts.map(p => p.kind === 'call' ? { type: 'tool_use', id: p.id, name: p.name, input: JSON.parse(p.arguments) } :
            p.kind === 'result' ? { type: 'tool_result', tool_use_id: p.id, content: p.content.map(value), ...(p.error ? { is_error: true } : {}) } : value(p));
        const previous = messages.at(-1);
        if (previous?.role === message.role) previous.content.push(...content);
        else messages.push({ role: message.role, content });
    }
    return { model: turn.model, messages, stream: true, max_tokens: turn.maxTokens ?? 4096,
        ...(system.length ? { system } : {}),
        ...(turn.tools.length ? { tools: turn.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })), tool_choice: { type: turn.choice === 'required' ? 'any' : 'auto' } } : {}),
        ...(turn.temperature !== undefined ? { temperature: turn.temperature } : {}), ...(turn.topP !== undefined ? { top_p: turn.topP } : {}), ...(turn.stop ? { stop_sequences: turn.stop } : {}) };
}

export async function* messagesEvents(response: Response, signal: AbortSignal): AsyncGenerator<InferenceEvent> {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ProxyError(502, 'Missing native Messages stream.', 'upstream_error');
    let input = 0, output = 0, cached: number | undefined;
    let reason: 'stop' | 'tool_calls' | 'length' = 'stop';
    let completed = false;
    const toolArguments = new Map<number, boolean>();
    for await (const event of parseSSE(response.body)) {
        checkAbort(signal);
        let data: any;
        try { data = JSON.parse(event.data); } catch { throw new ProxyError(502, 'Invalid native Messages event.', 'upstream_error'); }
        if (data.type === 'error' || data.error) throw new ProxyError(502, 'Native Messages inference failed.', 'upstream_error');
        if (data.type === 'message_start') {
            input = data.message?.usage?.input_tokens ?? 0;
            cached = data.message?.usage?.cache_read_input_tokens;
            output = data.message?.usage?.output_tokens ?? 0;
        }
        if (data.type === 'content_block_start') {
            const block = data.content_block;
            if (block?.type === 'text' && block.text) yield { kind: 'text', text: block.text };
            if (block?.type === 'tool_use') {
                const initial = block.input && Object.keys(block.input).length ? JSON.stringify(block.input) : '';
                toolArguments.set(data.index, !!initial);
                yield { kind: 'tool', index: data.index, id: block.id, name: block.name, arguments: initial };
            }
        }
        if (data.type === 'content_block_delta') {
            if (data.delta?.type === 'text_delta') yield { kind: 'text', text: data.delta.text };
            if (data.delta?.type === 'input_json_delta') {
                if (data.delta.partial_json) toolArguments.set(data.index, true);
                yield { kind: 'tool', index: data.index, arguments: data.delta.partial_json };
            }
        }
        if (data.type === 'message_delta') {
            output = data.usage?.output_tokens ?? output;
            reason = data.delta?.stop_reason === 'tool_use' ? 'tool_calls' : data.delta?.stop_reason === 'max_tokens' ? 'length' : 'stop';
        }
        if (data.type === 'message_stop') {
            for (const [index, supplied] of toolArguments) if (!supplied) yield { kind: 'tool', index, arguments: '{}' };
            completed = true;
            yield { kind: 'usage', usage: { input, output, cached, estimated: false } };
            yield { kind: 'finish', reason };
        }
    }
    if (!completed) throw new ProxyError(502, 'Native Messages stream ended without completion.', 'upstream_error');
}
