export class ProxyError extends Error {
    constructor(public status: number, message: string, public type = 'invalid_request_error') { super(message); }
}
export function abortError(): ProxyError { return new ProxyError(499, 'Request cancelled.', 'cancelled'); }
export function checkAbort(signal: AbortSignal): void { if (signal.aborted)
    throw signal.reason ?? abortError(); }
export function errorInfo(error: unknown): ProxyError {
    if (error instanceof ProxyError)
        return error;
    if (error instanceof Error && error.name === 'AbortError')
        return abortError();
    // Unknown upstream/library exceptions may contain credential-bearing URLs or bodies.
    return new ProxyError(502, 'Upstream request failed. See backend readiness and try again.', 'upstream_error');
}
