import { Message, Part, Protocol, Tool, Turn, ValuePart, Choice } from './types';
import { ProxyError } from './errors';
export type Obj = Record<string, any>;
export function object(value: unknown, name = 'value'): Obj {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ProxyError(400, `${name} must be an object.`);
    return value as Obj;
}
function array(value: unknown, name: string): any[] { if (!Array.isArray(value))
    throw new ProxyError(400, `${name} must be an array.`); return value; }
function string(value: unknown, name: string): string { if (typeof value !== 'string')
    throw new ProxyError(400, `${name} must be a string.`); return value; }
function positive(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ProxyError(400, `${name} must be a positive integer.`); return Number(value); }
function numeric(value: unknown, name: string, max: number): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max)
    throw new ProxyError(400, `${name} is out of range.`); return value; }
function args(value: unknown): string {
    if (typeof value === 'string') {
        try {
            object(JSON.parse(value), 'tool arguments');
        }
        catch {
            throw new ProxyError(400, 'Tool arguments must be a JSON object.');
        }
        return value;
    }
    return JSON.stringify(object(value, 'tool input'));
}
function image(url: unknown): ValuePart {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(string(url, 'image data'));
    if (!match || !match[2] || match[2].length % 4 !== 0 || Buffer.from(match[2], 'base64').toString('base64') !== match[2])
        throw new ProxyError(400, 'Images must be valid inline base64 PNG, JPEG or WebP data; remote URLs are unsupported.');
    return { kind: 'image', mime: match[1] as 'image/png', data: match[2] };
}
function values(content: unknown): ValuePart[] {
    if (typeof content === 'string')
        return [{ kind: 'text', text: content }];
    return array(content, 'content').map(raw => {
        const block = object(raw, 'content block');
        if (['text', 'input_text', 'output_text'].includes(block.type))
            return { kind: 'text', text: string(block.text, 'text') };
        if (block.type === 'image_url')
            return image(object(block.image_url).url);
        if (block.type === 'input_image') {
            if (block.file_id)
                throw new ProxyError(400, 'Image file IDs are unsupported.');
            return image(block.image_url);
        }
        if (block.type === 'image') {
            const source = object(block.source);
            if (source.type !== 'base64')
                throw new ProxyError(400, 'Only inline base64 image sources are supported.');
            return image(`data:${string(source.media_type, 'media_type')};base64,${string(source.data, 'image data')}`);
        }
        throw new ProxyError(400, `Unsupported content block: ${String(block.type).slice(0, 80)}.`);
    });
}
function choice(value: unknown, protocol: Protocol): Choice {
    if (value === undefined)
        return 'auto';
    if (typeof value === 'string' && ['auto', 'none', 'required'].includes(value))
        return value as Choice;
    const c = object(value, 'tool_choice');
    if (['auto', 'none'].includes(c.type))
        return c.type;
    if (c.type === 'any' || c.type === 'required')
        return 'required';
    if (c.type === 'tool' || c.type === 'custom' || c.type === 'function')
        return { name: string(protocol === 'chat' ? object(c.function).name : c.name, 'tool choice name') };
    throw new ProxyError(400, 'Unsupported tool_choice.');
}
function internalName(name: string, namespace?: string): string { return namespace ? namespace + '__' + name : name; }
function tools(raw: unknown, protocol: Protocol, namespace?: string): Tool[] {
    if (raw === undefined)
        return [];
    const result = array(raw, 'tools').flatMap(rawTool => {
        const t = object(rawTool, 'tool');
        const custom = protocol === 'responses' && t.type === 'custom';
        if (protocol === 'responses' && t.type === 'namespace') {
            if (namespace)
                throw new ProxyError(400, 'Nested tool namespaces are unsupported.');
            const ns = string(t.name, 'namespace');
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(ns))
                throw new ProxyError(400, 'Invalid tool namespace.');
            return tools(t.tools, protocol, ns);
        }
        if (protocol === 'responses' && typeof t.type === 'string' && t.type.startsWith('web_search'))
            throw new ProxyError(400, 'This proxy does not provide hosted web search. Set top-level web_search = "disabled" in your Codex config, restart Codex, and start a new chat. Client-side tools remain available.');
        if (protocol !== 'messages' && t.type !== 'function' && !custom)
            throw new ProxyError(400, `Unsupported hosted tool: ${String(t.type).slice(0, 80)}. Tools execute in your client.`);
        if (protocol === 'messages' && t.type && t.type !== 'custom')
            throw new ProxyError(400, 'Anthropic server tools are unsupported.');
        const f = protocol === 'chat' ? object(t.function, 'function') : t;
        const name = string(f.name, 'tool name');
        if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name))
            throw new ProxyError(400, 'Invalid tool name.');
        let description = f.description === undefined ? '' : string(f.description, 'tool description');
        if (custom) {
            description += '\nReturn the complete raw tool input as the input string. It is passed unchanged to the client.';
            if (t.format)
                description += '\nRequested input format (guidance, not enforced): ' + JSON.stringify(t.format);
        }
        const parameters = custom ? { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false } : object(f.parameters ?? f.input_schema ?? { type: 'object', properties: {} }, 'tool schema');
        const mapped = internalName(name, namespace);
        if (mapped.length > 128)
            throw new ProxyError(400, 'Namespaced tool name exceeds limit.');
        return [{ name: mapped, description, parameters, custom, ...(namespace ? { namespace, wireName: name } : {}) }];
    });
    if (new Set(result.map(t => t.name)).size !== result.length)
        throw new ProxyError(400, 'Tool names must be unique.');
    return result;
}
function chatMessages(raw: unknown): Message[] {
    return array(raw, 'messages').map(item => {
        const m = object(item, 'message');
        const parts: Part[] = m.content == null ? [] : values(m.content);
        if (m.role === 'tool')
            return { role: 'user', parts: [{ kind: 'result', id: string(m.tool_call_id, 'tool_call_id'), content: parts as ValuePart[] }] };
        if (!['system', 'developer', 'user', 'assistant'].includes(m.role))
            throw new ProxyError(400, 'Invalid message role.');
        if (m.tool_calls !== undefined) {
            if (m.role !== 'assistant')
                throw new ProxyError(400, 'Tool calls require an assistant message.');
            for (const rawCall of array(m.tool_calls, 'tool_calls')) {
                const c = object(rawCall);
                const f = object(c.function);
                if (c.type !== 'function')
                    throw new ProxyError(400, 'Chat tools must use function calls.');
                parts.push({ kind: 'call', id: string(c.id, 'call ID'), name: string(f.name, 'name'), arguments: args(f.arguments), custom: false });
            }
        }
        return { role: m.role === 'developer' ? 'system' : m.role, parts };
    });
}
function anthropicMessages(raw: unknown): Message[] {
    return array(raw, 'messages').map(item => {
        const m = object(item);
        if (!['user', 'assistant'].includes(m.role))
            throw new ProxyError(400, 'Messages roles must be user or assistant.');
        if (typeof m.content === 'string')
            return { role: m.role, parts: values(m.content) };
        const parts: Part[] = array(m.content, 'content').map(rawBlock => {
            const b = object(rawBlock);
            if (b.type === 'tool_use') {
                if (m.role !== 'assistant')
                    throw new ProxyError(400, 'tool_use requires assistant role.');
                return { kind: 'call', id: string(b.id, 'id'), name: string(b.name, 'name'), arguments: args(b.input), custom: false };
            }
            if (b.type === 'tool_result') {
                if (m.role !== 'user')
                    throw new ProxyError(400, 'tool_result requires user role.');
                return { kind: 'result', id: string(b.tool_use_id, 'tool_use_id'), content: values(b.content ?? ''), error: b.is_error === true };
            }
            return values([b])[0]!;
        });
        return { role: m.role, parts };
    });
}
function responseMessages(raw: unknown, warnings: string[]): Message[] {
    if (typeof raw === 'string')
        return [{ role: 'user', parts: values(raw) }];
    const messages: Message[] = [];
    for (const item of array(raw, 'input')) {
        const m = object(item);
        if (m.type === 'function_call' || m.type === 'custom_tool_call') {
            const custom = m.type === 'custom_tool_call';
            messages.push({ role: 'assistant', parts: [{ kind: 'call', id: string(m.call_id, 'call_id'), name: internalName(string(m.name, 'name'), m.namespace === undefined ? undefined : string(m.namespace, 'namespace')), arguments: custom ? JSON.stringify({ input: string(m.input, 'input') }) : args(m.arguments), custom }] });
        }
        else if (m.type === 'function_call_output' || m.type === 'custom_tool_call_output') {
            messages.push({ role: 'user', parts: [{ kind: 'result', id: string(m.call_id, 'call_id'), content: values(m.output) }] });
        }
        else if (m.type === 'reasoning') {
            if (m.encrypted_content)
                throw new ProxyError(400, 'Encrypted reasoning history is unsupported. Configure the client for full text history and local compaction.');
            warnings.push('reasoning_history_not_forwarded');
        }
        else if (!m.type || m.type === 'message') {
            messages.push(...chatMessages([{ role: m.role, content: m.content }]));
        }
        else
            throw new ProxyError(400, `Unsupported Responses input item: ${String(m.type).slice(0, 80)}.`);
    }
    return messages;
}
export function normalize(raw: unknown, protocol: Protocol, countOnly = false): Turn {
    const b = object(raw, 'request');
    const warnings: string[] = [];
    if (b.stream !== undefined && typeof b.stream !== 'boolean')
        throw new ProxyError(400, 'stream must be boolean.');
    if (b.store === true || b.previous_response_id != null || b.background === true || b.conversation != null)
        throw new ProxyError(400, 'Server-side conversation storage, background jobs and previous_response_id are unsupported. Send complete history with store:false.');
    if (b.n !== undefined && b.n !== 1)
        throw new ProxyError(400, 'Only one completion per request is supported.');
    for (const key of ['audio', 'modalities', 'prediction', 'logprobs', 'top_logprobs', 'response_format'])
        if (b[key] !== undefined)
            throw new ProxyError(400, `${key} is unsupported.`);
    if (protocol === 'responses' && b.text?.format && b.text.format.type !== 'text')
        throw new ProxyError(400, 'Constrained output formats are unsupported.');
    for (const key of ['thinking', 'cache_control', 'metadata', 'service_tier', 'reasoning', 'text', 'include', 'parallel_tool_calls', 'context_management'])
        if (b[key] !== undefined)
            warnings.push(`${key}_compatibility_hint`);
    const messages = protocol === 'responses' ? responseMessages(b.input, warnings) : protocol === 'messages' ? anthropicMessages(b.messages) : chatMessages(b.messages);
    const instructions = protocol === 'messages' ? b.system : protocol === 'responses' ? b.instructions : undefined;
    if (instructions !== undefined && instructions !== null) {
        const parts = values(instructions);
        if (parts.some(p => p.kind !== 'text'))
            throw new ProxyError(400, 'System instructions must be text.');
        messages.unshift({ role: 'system', parts });
    }
    if (!messages.length)
        throw new ProxyError(400, 'At least one message is required.');
    const t: Turn = { protocol, model: b.model === undefined ? '' : string(b.model, 'model'), messages, tools: tools(b.tools, protocol), choice: choice(b.tool_choice, protocol), stream: b.stream === true, warnings };
    const max = protocol === 'responses' ? b.max_output_tokens : b.max_completion_tokens ?? b.max_tokens;
    if (max !== undefined)
        t.maxTokens = positive(max, 'max tokens');
    else if (protocol === 'messages' && !countOnly)
        throw new ProxyError(400, 'max_tokens is required.');
    if (b.temperature !== undefined)
        t.temperature = numeric(b.temperature, 'temperature', 2);
    if (b.top_p !== undefined)
        t.topP = numeric(b.top_p, 'top_p', 1);
    const stop = b.stop_sequences ?? b.stop;
    if (stop !== undefined && stop !== null)
        t.stop = typeof stop === 'string' ? [stop] : array(stop, 'stop sequences').map(v => string(v, 'stop sequence'));
    if (b.reasoning_effort !== undefined) {
        const effort = string(b.reasoning_effort, 'reasoning_effort');
        if (!['none', 'minimal', 'low', 'medium', 'high'].includes(effort))
            throw new ProxyError(400, 'Unsupported reasoning effort.');
        t.reasoningEffort = effort;
    }
    if (t.choice === 'none')
        t.tools = [];
    if (typeof t.choice === 'object') {
        const name = t.choice.name;
        t.tools = t.tools.filter(tool => tool.name === name || (tool.wireName === name && tool.namespace === b.tool_choice?.namespace));
        if (!t.tools.length)
            throw new ProxyError(400, 'Named tool_choice must refer to a declared tool.');
        t.choice = 'required';
    }
    if (t.choice === 'required' && !t.tools.length)
        throw new ProxyError(400, 'Required tool_choice needs tools.');
    // Preserve ordered content and reject orphaned, repeated or mismatched tool results.
    const pending = new Set<string>();
    const calls = new Set<string>();
    for (const m of messages)
        for (const p of m.parts) {
            if (p.kind === 'call') {
                if (!p.id || calls.has(p.id))
                    throw new ProxyError(400, 'Duplicate or empty tool-call ID.');
                calls.add(p.id);
                pending.add(p.id);
            }
            if (p.kind === 'result') {
                if (!pending.delete(p.id))
                    throw new ProxyError(400, 'Tool result must follow its matching tool call exactly once.');
            }
        }
    if (pending.size)
        throw new ProxyError(400, 'Provide results for all previous tool calls before continuing inference.');
    t.warnings = [...new Set(t.warnings)];
    return t;
}
export function estimatedInput(turn: Turn): number { return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify({ messages: turn.messages, tools: turn.tools })) / 4)); }
