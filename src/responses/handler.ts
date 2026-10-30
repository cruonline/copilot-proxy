import { IncomingMessage, ServerResponse } from 'http';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { Collector } from './collector';
import { normalize } from './normalize';
import { errorInfo, ProxyError } from './errors';
import { InferenceEvent, Turn } from './types';
import { WireStream } from './wire';
import { forwardNative } from './native';
import { MAX_REQUEST_BODY_SIZE, REQUEST_TIMEOUT_MS, STREAM_INACTIVITY_TIMEOUT_MS } from '../core';

export type ResponsesInference = (turn: Turn, signal: AbortSignal) => AsyncIterable<InferenceEvent>;
export type NativeResponses = (path: string, raw: unknown, signal: AbortSignal, method: string) => Promise<Response>;

async function body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_REQUEST_BODY_SIZE) throw new ProxyError(413, 'Request body exceeds limit.');
        chunks.push(Buffer.from(chunk));
    }
    let bytes: Buffer = Buffer.concat(chunks);
    const encoding = req.headers['content-encoding'] || 'identity';
    const options = { maxOutputLength: MAX_REQUEST_BODY_SIZE };
    try {
        if (encoding === 'gzip') bytes = await promisify(zlib.gunzip)(bytes, options);
        else if (encoding === 'deflate') bytes = await promisify(zlib.inflate)(bytes, options);
        else if (encoding === 'br') bytes = await promisify(zlib.brotliDecompress)(bytes, options);
        else if (encoding === 'zstd') {
            const decompress = (zlib as unknown as { zstdDecompress?: typeof zlib.gunzip }).zstdDecompress;
            if (!decompress) throw new ProxyError(415, 'Zstd requests require a newer VS Code Node runtime. Disable Codex request compression or upgrade VS Code.');
            bytes = await promisify(decompress)(bytes, options);
        } else if (encoding !== 'identity') throw new ProxyError(415, 'Unsupported request content encoding.');
    } catch (error) {
        if (error instanceof ProxyError) throw error;
        throw new ProxyError((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ? 413 : 400, 'Invalid compressed request or decoded size limit exceeded.');
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ProxyError(400, 'Invalid JSON request.'); }
}

/** Authentication/CORS are handled by the existing server before entering this route. */
export async function handleResponses(req: IncomingMessage, res: ServerResponse, headers: Record<string, string>, infer: ResponsesInference, native?: NativeResponses, sanitize: (text: string) => string = text => text): Promise<void> {
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(new ProxyError(499, 'Client disconnected.', 'cancelled')); };
    res.on('close', cancel);
    let timeout = setTimeout(() => controller.abort(new ProxyError(408, 'Request timeout.', 'timeout_error')), REQUEST_TIMEOUT_MS);
    const reset = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => controller.abort(new ProxyError(408, 'Stream inactivity timeout.', 'timeout_error')), STREAM_INACTIVITY_TIMEOUT_MS);
    };
    const abortRequest = () => { if (!req.complete) req.destroy(); };
    controller.signal.addEventListener('abort', abortRequest);
    let wire: WireStream | undefined;
    try {
        const raw = req.method === 'POST' ? await body(req) : undefined;
        const route = (req.url || '').split('?')[0].replace(/^\/v1/, '');
        if (native) {
            const response = await native(route, raw, controller.signal, req.method || 'POST');
            for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
            if (response.headers.get('content-type')?.includes('text/event-stream')) reset();
            await forwardNative(response, res, controller.signal, sanitize, false, 32 * 1024 * 1024, reset);
            return;
        }
        if (route !== '/responses' || req.method !== 'POST') throw new ProxyError(501, 'Stored Responses and remote compaction require the direct Responses backend. Use complete history and local compaction.', 'unsupported_feature');
        const turn = normalize(raw, 'responses');
        const collector = new Collector(turn);
        if (turn.stream) reset();
        for await (const event of infer(turn, controller.signal)) {
            if (controller.signal.aborted) throw controller.signal.reason;
            if (turn.stream) {
                reset();
                if (!wire) {
                    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
                    wire = new WireStream(res, collector, controller.signal);
                    await wire.start();
                }
                await wire.consume(event);
            } else collector.consume(event);
        }
        collector.complete();
        if (turn.stream) {
            if (!wire) throw new ProxyError(502, 'Empty upstream stream.', 'upstream_error');
            await wire.complete();
            res.end();
        } else {
            res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(collector.json()));
        }
    } catch (error) {
        const failure = errorInfo(controller.signal.aborted ? controller.signal.reason : error);
        if (!res.destroyed && !res.writableEnded) {
            if (!res.headersSent) {
                res.writeHead(failure.status === 499 ? 408 : failure.status, { ...headers, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: failure.message, type: failure.type } }));
            } else {
                // The inference signal may already be cancelled; the terminal error must still be writable.
                if (wire) {
                    try { await wire.error(failure.message, failure.type, new AbortController().signal); } catch { /* disconnected */ }
                }
                res.end();
            }
        }
    } finally {
        clearTimeout(timeout);
        controller.abort();
        controller.signal.removeEventListener('abort', abortRequest);
        res.off('close', cancel);
    }
}
