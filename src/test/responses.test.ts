import { expect } from 'chai';
import * as http from 'http';
import * as zlib from 'zlib';
import { handleResponses, ResponsesInference, NativeResponses } from '../responses/handler';
import { normalize } from '../responses/normalize';
import { Turn } from '../responses/types';
import { CopilotAuth, DirectBackend, approvedURL } from '../responses/backends/direct';
import { inferResponses, responseMessages } from '../responses/vscodeAdapter';
import type * as vscode from 'vscode';

describe('Recovered Codex Responses compatibility', () => {
    let server: http.Server;
    let base: string;
    let turns: Turn[];
    let infer: ResponsesInference;
    let native: NativeResponses | undefined;
    beforeEach(async () => {
        turns = [];
        native = undefined;
        infer = async function* (turn) { turns.push(turn); yield { kind: 'text', text: 'Hello 🌍' }; yield { kind: 'finish', reason: 'stop' }; };
        server = http.createServer((req, res) => { void handleResponses(req, res, { 'Access-Control-Allow-Origin': 'http://localhost' }, (turn, signal) => infer(turn, signal), native); });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`;
    });
    afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

    it('returns JSON and full ordered SSE text lifecycles with complete response output', async () => {
        for (const stream of [false, true]) {
            const response = await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify({ input: 'Hi', stream, store: false }) });
            expect(response.status).to.equal(200);
            const text = await response.text();
            if (!stream) expect(JSON.parse(text).output[0].content[0].text).to.equal('Hello 🌍');
            else {
                const events = text.trim().split('\n\n').map(event => JSON.parse(event.split('data: ')[1]));
                expect(events.map(event => event.sequence_number)).to.deep.equal(events.map((_, i) => i));
                expect(events.map(event => event.type)).to.include.members(['response.created', 'response.output_text.delta', 'response.output_text.done', 'response.output_item.done', 'response.completed']);
                expect(events.at(-1).response.output[0].content[0].text).to.equal('Hello 🌍');
            }
        }
    });

    it('round-trips namespaced function and freeform apply_patch calls/results without changing IDs', async () => {
        const tools = [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object' } }, { type: 'custom', name: 'apply_patch' }] }];
        infer = async function* (turn) {
            turns.push(turn);
            yield { kind: 'tool', index: 0, id: 'read-id', name: 'functions__read_file', arguments: '{"path":"x"}' };
            yield { kind: 'tool', index: 1, id: 'patch-id', name: 'functions__apply_patch', arguments: JSON.stringify({ input: '*** Begin Patch\n*** End Patch' }) };
            yield { kind: 'finish', reason: 'tool_calls' };
        };
        const response = await fetch(base + '/responses', { method: 'POST', body: JSON.stringify({ input: 'Edit', tools }) });
        const output = (await response.json() as { output: Record<string, unknown>[] }).output;
        expect(output[1]).to.include({ type: 'custom_tool_call', call_id: 'patch-id', namespace: 'functions', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch' });
        const turn = normalize({ input: [{ role: 'user', content: 'Edit' }, ...output,
            { type: 'function_call_output', call_id: 'read-id', output: 'before' },
            { type: 'custom_tool_call_output', call_id: 'patch-id', output: 'patched' }], tools }, 'responses');
        expect(turn.messages.flatMap(message => message.parts).filter(part => part.kind === 'result').map(part => part.kind === 'result' && part.id)).to.deep.equal(['read-id', 'patch-id']);
        expect(turn.tools.map(tool => tool.name)).to.deep.equal(['functions__read_file', 'functions__apply_patch']);
    });

    it('bounds decoding and accepts gzip requests before parsing JSON', async () => {
        const compressed = zlib.gzipSync(JSON.stringify({ input: 'Compressed hello' }));
        const response = await fetch(base + '/v1/responses', { method: 'POST', headers: { 'Content-Encoding': 'gzip' }, body: compressed });
        expect(response.status).to.equal(200);
        expect(turns[0].messages[0].parts[0]).to.deep.equal({ kind: 'text', text: 'Compressed hello' });
        const malformed = await fetch(base + '/v1/responses', { method: 'POST', headers: { 'Content-Encoding': 'gzip' }, body: 'invalid' });
        expect(malformed.status).to.equal(400);
    });

    it('rejects unsupported public storage/compaction/search instead of silently dropping them', async () => {
        for (const request of [{ input: 'Hi', previous_response_id: 'resp_old' }, { input: 'Hi', tools: [{ type: 'web_search' }] }]) {
            const response = await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify(request) });
            expect(response.status).to.equal(400);
        }
        const compact = await fetch(base + '/v1/responses/compact', { method: 'POST', body: '{}' });
        expect(compact.status).to.equal(501);
        expect(turns).to.have.length(0);
    });

    it('emits failure rather than completion for truncated or failed inference', async () => {
        infer = async function* () { yield { kind: 'text', text: 'partial' }; };
        const response = await fetch(base + '/v1/responses', { method: 'POST', body: JSON.stringify({ input: 'Hi', stream: true }) });
        const text = await response.text();
        expect(text).to.contain('response.failed').and.not.to.contain('response.completed');
    });

    it('forwards native reasoning, compaction, stored responses, and SSE bytes unchanged with CORS', async () => {
        const wire = 'event: response.completed\ndata: {"type":"response.completed","response":{"output":[],"usage":{"input_tokens":2,"output_tokens":1}}}\n\n';
        const observed: unknown[] = [];
        native = async (route, raw, _signal, method) => {
            observed.push({ route, raw, method });
            return new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } });
        };
        const raw = { model: 'native', input: [{ type: 'reasoning', encrypted_content: 'opaque' }], tools: [{ type: 'web_search' }], store: true };
        for (const route of ['/v1/responses', '/v1/responses/compact']) {
            const response = await fetch(base + route, { method: 'POST', body: JSON.stringify(raw) });
            expect(await response.text()).to.equal(wire);
            expect(response.headers.get('access-control-allow-origin')).to.equal('http://localhost');
        }
        const stored = await fetch(base + '/v1/responses/resp_saved', { method: 'DELETE' });
        expect(stored.status).to.equal(200);
        expect(observed).to.deep.equal([{ route: '/responses', raw, method: 'POST' }, { route: '/responses/compact', raw, method: 'POST' }, { route: '/responses/resp_saved', raw: undefined, method: 'DELETE' }]);
    });

    it('isolates upstream credentials and prevents unapproved origin/redirect forwarding', async () => {
        expect(() => approvedURL('https://evil.example')).to.throw('Unapproved');
        const seen: RequestInit[] = [];
        const request: typeof fetch = async (url, init) => {
            seen.push(init || {});
            if (String(url).includes('copilot_internal')) return Response.json({ token: 'native-secret', expires_at: Date.now() / 1000 + 3600, endpoints: { api: 'https://api.githubcopilot.com' } });
            return Response.json({ object: 'response', output: [] });
        };
        const auth = new CopilotAuth(async () => 'github-secret', request);
        const backend = new DirectBackend(auth, request);
        await backend.nativeRequest('/responses', { input: 'Hi' }, new AbortController().signal, { Authorization: 'Bearer client-key' });
        expect(seen.every(init => init.redirect === 'error')).to.equal(true);
        expect(new Headers(seen[1].headers).get('Authorization')).to.equal('Bearer native-secret');
        backend.dispose();
    });

    it('maps images and tool history to VS Code and filters supplementary output without losing calls', async () => {
        class Text { constructor(public value: string) {} }
        class Data { constructor(public data: Uint8Array, public mime: string) {} }
        class Call { constructor(public callId: string, public name: string, public input: unknown) {} }
        class Result { constructor(public callId: string, public content: unknown[]) {} }
        class Message { constructor(public role: number, public content: unknown[]) {} }
        let cancelled = false;
        class Cancellation { token = {}; cancel() { cancelled = true; } dispose() {} }
        const api = { LanguageModelTextPart: Text, LanguageModelDataPart: Data, LanguageModelToolCallPart: Call, LanguageModelToolResultPart: Result,
            LanguageModelChatMessage: Message, CancellationTokenSource: Cancellation,
            LanguageModelChatMessageRole: { User: 1, Assistant: 2 }, LanguageModelChatToolMode: { Auto: 1, Required: 2 } } as unknown as typeof vscode;
        const turn = normalize({ instructions: 'Be precise', input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,YWJj' }] },
            { type: 'function_call', call_id: 'prior', name: 'read', arguments: '{}' }, { type: 'function_call_output', call_id: 'prior', output: 'text' }],
            tools: [{ type: 'function', name: 'read', parameters: { type: 'object' } }] }, 'responses');
        const messages = responseMessages(turn, api);
        expect(messages[0].content[1]).to.be.instanceOf(Data);
        expect(messages[1].content[0]).to.be.instanceOf(Call);
        expect(messages[2].content[0]).to.be.instanceOf(Result);
        const model = { id: 'actual-model' } as vscode.LanguageModelChat;
        const events = [];
        for await (const event of inferResponses(turn, new AbortController().signal, async () => model, async () => ({ model, response: {
            stream: (async function* () { yield new Text('Hi'); yield { supplementary: true }; yield new Call('new', 'read', {}); })()
        } as unknown as vscode.LanguageModelChatResponse }), api)) events.push(event);
        expect(events).to.deep.equal([{ kind: 'text', text: 'Hi' }, { kind: 'tool', index: 0, id: 'new', name: 'read', arguments: '{}' }, { kind: 'finish', reason: 'tool_calls' }]);
        expect(turn.model).to.equal('actual-model');
        expect(turn.warnings).to.include('vscode_non_text_parts_omitted');
        expect(cancelled).to.equal(true);
    });

    it('cancels inference when the HTTP client disconnects', async () => {
        let aborted = false;
        infer = async function* (_turn, signal) {
            yield { kind: 'text', text: 'started' };
            await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
        };
        await new Promise<void>((resolve, reject) => {
            const req = http.request(base + '/v1/responses', { method: 'POST' }, res => {
                res.once('data', () => { res.destroy(); resolve(); });
            });
            req.on('error', reject);
            req.end(JSON.stringify({ input: 'Wait', stream: true }));
        });
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(aborted).to.equal(true);
    });
});
