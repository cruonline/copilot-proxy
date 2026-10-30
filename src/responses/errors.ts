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
    // VS Code throws the provider's JSON rejection as a regular Error. Only expose
    // the known schema diagnostic, never arbitrary exception bodies or URLs.
    if (error instanceof Error && error.message.length < 65536) {
        const schemaDiagnostic = /tools\.\d+\.[A-Za-z0-9_.-]*input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level/.exec(error.message)?.[0];
        if (schemaDiagnostic) return new ProxyError(400, `Copilot rejected tool schema: ${schemaDiagnostic}`, 'invalid_request_error');
        try {
            const start = error.message.indexOf('{'), end = error.message.lastIndexOf('}');
            const rejection = JSON.parse(error.message.slice(start, end + 1)).error;
            if (rejection?.type === 'invalid_request_error') {
                return new ProxyError(400, 'Copilot rejected the request (invalid_request_error).', 'invalid_request_error');
            }
        } catch { /* Unrecognized errors remain private. */ }
    }
    // Unknown upstream/library exceptions may contain credential-bearing URLs or bodies.
    return new ProxyError(502, 'Upstream request failed. See backend readiness and try again.', 'upstream_error');
}
