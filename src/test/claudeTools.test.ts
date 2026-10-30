import { expect } from 'chai';
import type * as vscode from 'vscode';
import { claudeTools, unwrapClaudeArguments, unwrapClaudeEvents } from '../responses/claudeTools';
import { normalize } from '../responses/normalize';
import { inferResponses } from '../responses/vscodeAdapter';
import { CopilotAuth, DirectBackend } from '../responses/backends/direct';
import { errorInfo } from '../responses/errors';

const union = { anyOf: [
    { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
] };
function fixture(model = 'claude-sonnet-5.5') {
    return normalize({ model, input: [
        { role: 'user', content: 'Read' },
        { type: 'function_call', call_id: 'prior', name: 'custom', namespace: 'functions', arguments: '{"text":"before"}' },
        { type: 'function_call_output', call_id: 'prior', output: 'done' }
    ], tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'custom', parameters: union }] }] }, 'responses');
}

describe('Claude Codex tool schemas', () => {
    it('preserves top-level union constraints and wraps history without changing client data', () => {
        for (const key of ['anyOf', 'oneOf', 'allOf']) {
            const turn = fixture();
            turn.tools[0].parameters = { [key]: union.anyOf };
            const adapted = claudeTools(turn);
            expect(adapted.turn.tools[0].parameters).to.deep.equal({ type: 'object', properties: { arguments: { [key]: union.anyOf } }, required: ['arguments'], additionalProperties: false });
            expect(adapted.turn.messages[1].parts[0]).to.include({ id: 'prior', name: 'functions__custom', arguments: '{"arguments":{"text":"before"}}' });
            expect(turn.messages[1].parts[0]).to.include({ arguments: '{"text":"before"}' });
            expect(unwrapClaudeArguments('{"arguments":{"path":"x"}}', 'functions__custom', adapted.wrapped)).to.equal('{"path":"x"}');
        }
        const gpt = fixture('gpt-6.1-sol');
        expect(claudeTools(gpt).turn).to.equal(gpt);
        const nested = fixture();
        nested.tools[0].parameters = { type: 'object', properties: { value: union } };
        expect(claudeTools(nested).wrapped.size).to.equal(0);
    });

    it('rejects missing envelopes instead of passing wrong arguments to tools', () => {
        const wrapped = new Set(['functions__custom']);
        for (const raw of ['{}', '{"arguments":null}', '{"arguments":[]}', 'invalid']) {
            expect(() => unwrapClaudeArguments(raw, 'functions__custom', wrapped)).to.throw();
        }
    });

    it('rebases local schema references without changing literal tool values', () => {
        const turn = fixture();
        turn.tools[0].parameters = { anyOf: [{ $ref: '#/$defs/text' }], $defs: { text: { type: 'object', properties: { value: { type: 'string', default: '#/$defs/text' } } } } };
        const adapted = claudeTools(turn).turn.tools[0].parameters;
        expect(adapted).to.have.nested.property('properties.arguments.anyOf').that.deep.equals([{ $ref: '#/properties/arguments/$defs/text' }]);
        expect(adapted).to.have.nested.property('properties.arguments.$defs.text.properties.value.default', '#/$defs/text');
    });

    it('adapts real VS Code options, history and returned calls', async () => {
        class Text { constructor(public value: string) {} }
        class Call { constructor(public callId: string, public name: string, public input: unknown) {} }
        class Result { constructor(public callId: string, public content: unknown[]) {} }
        class Message { constructor(public role: number, public content: unknown[]) {} }
        class Cancellation { token = {}; cancel() {} dispose() {} }
        const api = { LanguageModelTextPart: Text, LanguageModelToolCallPart: Call, LanguageModelToolResultPart: Result,
            LanguageModelChatMessage: Message, CancellationTokenSource: Cancellation, LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
            LanguageModelChatToolMode: { Auto: 1, Required: 2 } } as unknown as typeof vscode;
        const model = { id: 'claude-sonnet-5.5' } as vscode.LanguageModelChat;
        const output = [];
        for await (const event of inferResponses(fixture(), new AbortController().signal, async () => model,
            async (_model, _requested, messages, options) => {
                expect(options.tools![0].inputSchema).to.have.nested.property('properties.arguments').that.deep.equals(union);
                expect((messages[1].content[0] as unknown as Call).input).to.deep.equal({ arguments: { text: 'before' } });
                return { model, response: { stream: (async function* () { yield new Call('new-id', 'functions__custom', { arguments: { path: 'x' } }); })() } as unknown as vscode.LanguageModelChatResponse };
            }, api)) output.push(event);
        expect(output[0]).to.deep.equal({ kind: 'tool', index: 0, id: 'new-id', name: 'functions__custom', arguments: '{"path":"x"}' });
    });

    it('adapts direct Chat and Messages tool schemas and fragmented envelopes', async () => {
        for (const endpoint of ['/chat/completions', '/messages']) {
            const request: typeof fetch = async (url, init) => {
                if (String(url).includes('copilot_internal')) return Response.json({ token: 'fixture-token', expires_at: Date.now() / 1000 + 3600 });
                if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'claude-sonnet-5.5', supported_endpoints: [endpoint] }] });
                const body = JSON.parse(init!.body as string);
                const schema = endpoint === '/messages' ? body.tools[0].input_schema : body.tools[0].function.parameters;
                expect(schema.properties.arguments).to.deep.equal(union);
                const history = endpoint === '/messages' ? body.messages[1].content[0].input : JSON.parse(body.messages[1].tool_calls[0].function.arguments);
                expect(history).to.deep.equal({ arguments: { text: 'before' } });
                const events = endpoint === '/messages' ? [
                    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'new-id', name: 'functions__custom', input: {} } },
                    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"arguments":' } },
                    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"x"}}' } },
                    { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }
                ] : [
                    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'new-id', function: { name: 'functions__custom', arguments: '{"arguments":' } }] } }] },
                    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"x"}}' } }] } }] },
                    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
                ];
                return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (endpoint === '/messages' ? '' : 'data: [DONE]\n\n'), { headers: { 'Content-Type': 'text/event-stream' } });
            };
            const backend = new DirectBackend(new CopilotAuth(async () => 'fixture-github', request), request);
            await backend.listModels(new AbortController().signal);
            const events = [];
            for await (const event of backend.chat(fixture(), new AbortController().signal)) events.push(event);
            expect(events.filter(event => event.kind === 'tool')).to.deep.equal([{ kind: 'tool', index: 0, id: 'new-id', name: 'functions__custom', arguments: '{"path":"x"}' }]);
            backend.dispose();
        }
    });

    it('does not complete incomplete adapted tool streams', async () => {
        const events = [];
        for await (const event of unwrapClaudeEvents((async function* () { yield { kind: 'tool' as const, index: 0, id: 'id', name: 'functions__custom', arguments: '{"arguments":' }; })(), new Set(['functions__custom']))) events.push(event);
        expect(events).to.deep.equal([]);
    });

    it('exposes the observed provider schema rejection as 400 without leaking unknown errors', () => {
        const diagnostic = 'tools.38.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level';
        const failure = errorInfo(new Error('400 ' + JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: diagnostic } })));
        expect(failure.status).to.equal(400);
        expect(failure.message).to.contain(diagnostic);
        expect(errorInfo(new Error(diagnostic)).status).to.equal(400);
        expect(errorInfo(new Error('Bearer synthetic-secret')).message).not.to.contain('synthetic-secret');
        expect(errorInfo(new Error(JSON.stringify({ error: { type: 'invalid_request_error', message: 'synthetic-secret' } }))).message).not.to.contain('synthetic-secret');
    });

    it('reports a direct provider schema rejection without discarding its diagnostic', async () => {
        const diagnostic = 'tools.38.custom.input_schema: input_schema does not support oneOf, allOf, or anyOf at the top level';
        const request: typeof fetch = async url => String(url).includes('copilot_internal')
            ? Response.json({ token: 'fixture-token', expires_at: Date.now() / 1000 + 3600 })
            : Response.json({ error: { type: 'invalid_request_error', message: diagnostic } }, { status: 400 });
        const backend = new DirectBackend(new CopilotAuth(async () => 'fixture-github', request), request);
        try {
            for await (const event of backend.chat(fixture(), new AbortController().signal)) expect(event).to.equal(undefined);
            throw new Error('Expected rejection');
        } catch (error) {
            expect(errorInfo(error).status).to.equal(400);
            expect((error as Error).message).to.contain(diagnostic);
        } finally { backend.dispose(); }
    });
});
