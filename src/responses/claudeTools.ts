import { InferenceEvent, Turn } from './types';
import { ProxyError } from './errors';

function nestedSchema(schema: Record<string, unknown>): Record<string, unknown> {
    // JSON pointer references were relative to the original schema root.
    // Rebase only schema keywords, leaving literal defaults/enum values intact.
    const visit = (value: unknown, scoped = false): unknown => {
        if (Array.isArray(value)) return value.map(child => visit(child, scoped));
        if (!value || typeof value !== 'object') return value;
        scoped ||= typeof (value as Record<string, unknown>).$id === 'string';
        return Object.fromEntries(Object.entries(value).map(([key, child]) => {
            if (!scoped && ['$ref', '$dynamicRef'].includes(key) && typeof child === 'string' && (child === '#' || child.startsWith('#/')))
                return [key, '#/properties/arguments' + child.slice(1)];
            if (['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(key) && child && typeof child === 'object')
                return [key, Object.fromEntries(Object.entries(child).map(([name, definition]) => [name, visit(definition, scoped)]))];
            if (['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'items', 'prefixItems', 'contains', 'additionalProperties', 'unevaluatedProperties', 'additionalItems', 'unevaluatedItems', 'propertyNames', 'contentSchema'].includes(key))
                return [key, visit(child, scoped)];
            return [key, child];
        }));
    };
    return visit(schema) as Record<string, unknown>;
}
/** Anthropic allows unions inside a property, but rejects them at the schema root.
 * Use an envelope so every original constraint and argument survives the boundary.
 */
export function claudeTools(turn: Turn): { turn: Turn; wrapped: Set<string> } {
    const wrapped = new Set<string>();
    if (!/claude/i.test(turn.model)) return { turn, wrapped };
    const tools = turn.tools.map(tool => {
        if (!['oneOf', 'allOf', 'anyOf'].some(key => key in tool.parameters)) return tool;
        wrapped.add(tool.name);
        return { ...tool, description: `${tool.description}\nSupply the tool's original arguments in the arguments property.`,
            parameters: { type: 'object', properties: { arguments: nestedSchema(tool.parameters) }, required: ['arguments'], additionalProperties: false } };
    });
    if (!wrapped.size) return { turn, wrapped };
    return { wrapped, turn: { ...turn, tools, messages: turn.messages.map(message => ({
        ...message, parts: message.parts.map(part => part.kind === 'call' && wrapped.has(part.name)
            ? { ...part, arguments: JSON.stringify({ arguments: JSON.parse(part.arguments) }) } : part)
    })) } };
}

export function unwrapClaudeArguments(raw: string, name: string, wrapped: Set<string>): string {
    if (!wrapped.has(name)) return raw;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new ProxyError(502, 'Claude returned invalid wrapped tool arguments.', 'upstream_error'); }
    const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).arguments : undefined;
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new ProxyError(502, 'Claude omitted the tool arguments envelope.', 'upstream_error');
    return JSON.stringify(input);
}

/** Buffer only adapted calls; clients must never see the upstream envelope. */
export async function* unwrapClaudeEvents(events: AsyncIterable<InferenceEvent>, wrapped: Set<string>): AsyncGenerator<InferenceEvent> {
    if (!wrapped.size) { yield* events; return; }
    const calls = new Map<number, { id?: string; name: string; arguments: string }>();
    let size = 0;
    for await (const event of events) {
        if (event.kind === 'tool') {
            const call = calls.get(event.index) ?? { name: '', arguments: '' };
            if (call.id && event.id && call.id !== event.id) throw new ProxyError(502, 'Claude changed a tool-call ID.', 'upstream_error');
            call.id = event.id ?? call.id;
            call.name += event.name ?? '';
            call.arguments += event.arguments ?? '';
            size += Buffer.byteLength((event.name ?? '') + (event.arguments ?? ''));
            if (size > 16 * 1024 * 1024 || calls.size > 1024) throw new ProxyError(502, 'Claude tool output exceeds limit.', 'upstream_error');
            calls.set(event.index, call);
        } else {
            if (event.kind === 'finish') {
                for (const [index, call] of calls) yield { kind: 'tool', index, ...call, arguments: unwrapClaudeArguments(call.arguments, call.name, wrapped) };
                calls.clear();
            }
            yield event;
        }
    }
}
