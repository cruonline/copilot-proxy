import { expect } from 'chai';
import * as vm from 'vm';
import { getConnectionGuide, connectionGuideScript } from '../connectionGuide';

describe('Connection guide', () => {
    it('documents every exposed route, aliases, preflight, and authenticated examples while stopped', () => {
        const { api, setup } = getConnectionGuide(9123, []);
        for (const route of ['/v1/chat/completions', '/chat/completions', '/v1/messages', '/messages',
            '/v1/models', '/models', '/v1/tools', '/tools', '/health']) expect(api).to.contain(route);
        expect(api).to.contain('Alias: <code>/</code>').and.to.contain('OPTIONS');
        expect(api).to.contain('tags=search&amp;name=file').and.to.contain('Bearer $COPILOT_GATEWAY_API_KEY');
        expect(api).to.contain('x-api-key: $COPILOT_GATEWAY_API_KEY');
        expect(api).not.to.contain('\n+');
        expect(setup).to.contain('http://127.0.0.1:9123/v1').and.to.contain('YOUR_MODEL_ID');
        for (const client of ['Codex', 'Claude Desktop', 'OpenAI Python', 'OpenAI JavaScript', 'Claude Code', 'Anthropic Python', 'Cline / Roo Code', 'LangChain Python']) {
            expect(setup).to.contain(client);
        }
        expect(setup).not.to.contain('not-needed');
        expect(setup).to.contain('Codex connects directly using Responses');
        expect(api).to.contain('/v1/responses');
        expect(setup).to.contain('setupClaudeGatewayBtn').and.to.contain('restoreClaudeGatewayBtn');
    });

    it('escapes model IDs and uses the configured default in dynamically generated examples', () => {
        const guide = getConnectionGuide(4567, [], '</script>"&test');
        expect(guide.setup).not.to.contain('</script>');
        expect(guide.setup).to.contain('&lt;/script&gt;');
        expect(guide.api).not.to.contain('8080');
        expect(guide.setup).to.contain('http://127.0.0.1:4567');
    });

    it('switches tabs and clients, supports keyboard navigation, copies examples and persists no secrets', () => {
        class Element {
            dataset: Record<string, string> = {};
            attributes: Record<string, string> = {};
            listeners: Record<string, (event?: { key: string; preventDefault(): void }) => void> = {};
            hidden = false;
            tabIndex = 0;
            focused = false;
            textContent = '';
            constructor(dataset: Record<string, string> = {}) { this.dataset = dataset; }
            setAttribute(name: string, value: string) { this.attributes[name] = value; }
            addEventListener(name: string, listener: Element['listeners'][string]) { this.listeners[name] = listener; }
            focus() { this.focused = true; }
        }
        const tabs = ['overview', 'api', 'clients'].map(id => new Element({ guideTab: id }));
        const clients = ['openai-python', 'claude-ps'].map(id => new Element({ client: id }));
        const elements = new Map<string, Element>();
        const get = (id: string) => {
            if (!elements.has(id)) elements.set(id, new Element());
            return elements.get(id)!;
        };
        const copy = new Element({ copy: 'safe example YOUR_SAVED_API_KEY' });
        const sent: unknown[] = [];
        let saved: unknown;
        let hidden = 0;
        vm.runInNewContext(connectionGuideScript, {
            vscode: { getState: () => ({ tab: 'clients', client: 'claude-ps', secret: 'must-not-persist' }),
                setState: (state: unknown) => { saved = state; }, postMessage: (message: unknown) => sent.push(message) },
            document: { getElementById: get, querySelectorAll: (selector: string) => selector === '[data-guide-tab]' ? tabs : selector === '[data-client]' ? clients : [copy] },
            window: { addEventListener() {} }, hideApiKey: () => { hidden++; }
        });
        expect(get('panel-clients').hidden).to.equal(false);
        expect(get('client-openai-python').hidden).to.equal(true);
        expect(saved).to.deep.equal({ tab: 'clients', client: 'claude-ps' });
        tabs[1].listeners.click();
        expect(tabs[1].attributes['aria-selected']).to.equal('true');
        expect(get('panel-overview').hidden).to.equal(true);
        tabs[1].listeners.keydown({ key: 'End', preventDefault() {} });
        expect(tabs[2].focused).to.equal(true);
        clients[0].listeners.click();
        expect(get('client-openai-python').hidden).to.equal(false);
        copy.listeners.click();
        expect(sent.at(-1)).to.deep.equal({ command: 'copyGuide', text: copy.dataset.copy });
        get('clientCopyKeyBtn').listeners.click();
        expect(sent.at(-1)).to.deep.equal({ command: 'copyApiKey' });
        get('setupClaudeGatewayBtn').listeners.click();
        expect(sent.at(-1)).to.deep.equal({ command: 'setupClaudeGateway' });
        get('restoreClaudeGatewayBtn').listeners.click();
        expect(sent.at(-1)).to.deep.equal({ command: 'restoreClaudeGateway' });
        expect(hidden).to.be.greaterThan(1);
    });
});
