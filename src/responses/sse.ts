import { ProxyError } from './errors';
export interface SSEEvent {
    event: string;
    data: string;
}
/** Streaming UTF-8 and line decoder. CR, LF and CRLF may cross any chunk boundary. */
export async function* parseSSE(chunks: AsyncIterable<Uint8Array>, maxEventBytes = 2 * 1024 * 1024): AsyncGenerator<SSEEvent> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let line = '', event = '', data: string[] = [], bytes = 0, afterCR = false;
    function consume(text: string): SSEEvent[] {
        const events: SSEEvent[] = [];
        for (const char of text) {
            if (afterCR) {
                afterCR = false;
                if (char === '\n')
                    continue;
            }
            if (char !== '\n' && char !== '\r') {
                line += char;
                bytes += Buffer.byteLength(char);
                if (bytes > maxEventBytes)
                    throw new ProxyError(502, 'Upstream SSE event exceeds limit.', 'upstream_error');
                continue;
            }
            afterCR = char === '\r';
            if (line === '') {
                if (data.length)
                    events.push({ event: event || 'message', data: data.join('\n') });
                event = '';
                data = [];
                bytes = 0;
            }
            else if (!line.startsWith(':')) {
                const colon = line.indexOf(':');
                const field = colon < 0 ? line : line.slice(0, colon);
                let value = colon < 0 ? '' : line.slice(colon + 1);
                if (value.startsWith(' '))
                    value = value.slice(1);
                if (field === 'data')
                    data.push(value);
                else if (field === 'event')
                    event = value;
            }
            line = '';
        }
        return events;
    }
    for await (const chunk of chunks)
        for (const event of consume(decoder.decode(chunk, { stream: true })))
            yield event;
    for (const event of consume(decoder.decode()))
        yield event;
    // SSE dispatch requires a blank line. A truncated last event is an upstream failure.
    if (line || data.length)
        throw new ProxyError(502, 'Upstream SSE stream ended inside an event.', 'upstream_error');
}
