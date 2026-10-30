import { expect } from 'chai';
import { CopilotAuth, DirectBackend } from '../responses/backends/direct';

describe('Direct Responses history item IDs', () => {
    for (const model of ['gpt-5.6-luna', 'claude-sonnet-5.5']) {
        it(`normalizes by tool type, not model family (${model})`, async () => {
            let forwarded: any;
            const request: typeof fetch = async (url, init) => {
                if (String(url).includes('copilot_internal')) return Response.json({ token: 'test', expires_at: Date.now() / 1000 + 3600 });
                forwarded = JSON.parse(init!.body as string);
                return Response.json({});
            };
            const backend = new DirectBackend(new CopilotAuth(async () => 'github', request), request);
            const input = [
                { type: 'custom_tool_call', id: 'fc_old', call_id: 'patch', name: 'apply_patch', input: 'patch' },
                { type: 'function_call', id: 'ctc_old', call_id: 'read', name: 'read', arguments: '{}' },
                { type: 'custom_tool_call_output', call_id: 'patch', output: 'done' },
                { type: 'message', id: 'msg_old', role: 'user', content: 'hello' }
            ];
            try {
                await backend.nativeRequest('/responses', { model, input }, new AbortController().signal);
                expect(forwarded.input[0]).to.include({ id: 'ctc_old', call_id: 'patch' });
                expect(forwarded.input[1]).to.include({ id: 'fc_old', call_id: 'read' });
                expect(forwarded.input.slice(2)).to.deep.equal(input.slice(2));
                expect(input[0].id).to.equal('fc_old');
                expect(input[1].id).to.equal('ctc_old');
            } finally { backend.dispose(); }
        });
    }
});
