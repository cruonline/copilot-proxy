import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as http from 'http';
import * as ts from 'typescript';
import * as os from 'os';

/** Execute the real extension with only the VS Code host replaced. */
describe('API key extension integration', () => {
    it('authenticates actual HTTP routes and manages keys through the real webview bridge', async () => {
        const commands = new Map<string, () => unknown>();
        const secrets = new Map<string, string>();
        const messages: any[] = [];
        const logs: string[] = [];
        let bridge: (message: any) => Promise<void> = async () => {};
        let clipboard = '';
        let confirmation: string | undefined = 'Replace Key';
        let failStorage = false;
        let server: http.Server | undefined;
        const catalogDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-catalog-integration-'));
        const globalState = new Map<string, unknown>();
        let selectableModels: Array<{ id: string; name: string; maxInputTokens: number }> = [];
        const offeredModels: string[][] = [];
        const confirmations: string[] = [];
        let cancelLabel = false;
        const settings = new Map<string, unknown>([['autoStart', false], ['port', 0]]);
        const upstreamRequests: Array<{ url: string; body: any }> = [];
        const upstreamFetch: typeof fetch = async (url, init) => {
            upstreamRequests.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : undefined });
            if (String(url).includes('copilot_internal')) return Response.json({ token: 'synthetic-copilot-token', expires_at: Date.now() / 1000 + 3600 });
            if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', supported_endpoints: ['/chat/completions'] }] });
            if (!String(url).endsWith('/chat/completions')) throw new Error('Unexpected upstream route');
            return new Response('data: {"choices":[{"index":0,"delta":{"content":"Hello from Sonnet"}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
        };
        const panel = {
            webview: { html: '', postMessage(message: any) { messages.push(message); }, onDidReceiveMessage(handler: typeof bridge) { bridge = handler; } },
            onDidDispose() {}, reveal() {}, dispose() {}
        };
        const output = { info: (text: string) => logs.push(text), warn: (text: string) => logs.push(text),
            error: (text: string) => logs.push(text), debug: (text: string) => logs.push(text), dispose() {} };
        const vscode = {
            version: '1.143.1', extensions: { getExtension: () => ({ packageJSON: { version: 'test' } }) },
            authentication: { getSession: async () => ({ accessToken: 'synthetic-github-token' }) },
            workspace: { getConfiguration: () => ({ get: (name: string, fallback: unknown) => settings.has(name) ? settings.get(name) : fallback,
                update: async (name: string, value: unknown) => { settings.set(name, value); } }) },
            ConfigurationTarget: { Global: 1 },
            window: {
                createOutputChannel: () => output,
                createStatusBarItem: () => ({ show() {}, dispose() {} }),
                createWebviewPanel: () => panel,
                showInformationMessage: async () => undefined,
                showErrorMessage: async () => undefined,
                showWarningMessage: async (text: string) => { confirmations.push(text); return confirmation; },
                showQuickPick: async (choices: Array<{ modelId: string }>) => { offeredModels.push(choices.map(choice => choice.modelId)); return choices[0]; },
                showInputBox: async (options: { value: string }) => cancelLabel ? undefined : `Label: ${options.value}`
            },
            commands: { registerCommand(name: string, handler: () => unknown) { commands.set(name, handler); return { dispose() {} }; } },
            lm: { onDidChangeChatModels: () => ({ dispose() {} }), selectChatModels: async () => selectableModels, tools: [] },
            StatusBarAlignment: { Right: 1 }, ViewColumn: { One: 1 },
            env: { clipboard: { async writeText(value: string) { clipboard = value; } } }
        };
        const exported: any = {};
        const source = fs.readFileSync(path.join(__dirname, '../extension.ts'), 'utf8');
        const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        vm.runInNewContext(compiled, {
            exports: exported, Buffer, AbortSignal, fetch: upstreamFetch, console: { log() {}, warn() {}, error() {} },
            setTimeout: (callback: () => void, delay: number) => { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
            clearTimeout,
            setInterval: (callback: () => void, delay: number) => { const timer = setInterval(callback, delay); timer.unref(); return timer; },
            clearInterval,
            require: (name: string) => name === 'vscode' ? vscode : name === 'http' ? {
                ...http, createServer: (handler: http.RequestListener) => { server = http.createServer(handler); return server; }
            } : require(name.startsWith('./') ? `../${name.slice(2)}` : name)
        });
        exported.activate({
            subscriptions: [], extension: { packageJSON: { version: 'test' } },
            globalStorageUri: { fsPath: catalogDirectory },
            globalState: { get(name: string) { return globalState.get(name); }, update(name: string, value: unknown) { globalState.set(name, value); } },
            secrets: { async get(name: string) { return secrets.get(name); }, async store(name: string, value: string) {
                if (failStorage) throw new Error('Storage unavailable');
                secrets.set(name, value);
            } }
        });
        try {
            await commands.get('copilot-gateway.start')!();
            if (!server!.listening) await new Promise<void>(resolve => server!.once('listening', resolve));
            const address = server!.address() as import('net').AddressInfo;
            const request = (route: string, headers: http.OutgoingHttpHeaders = {}, method = 'GET') => new Promise<number>(resolve => {
                const req = http.request({ hostname: '127.0.0.1', port: address.port, path: route, headers, method }, res => {
                    res.resume(); res.on('end', () => resolve(res.statusCode!));
                });
                req.end();
            });
            const key = [...secrets.values()][0];
            for (const route of ['/health', '/', '/v1/models', '/models', '/v1/model-catalog', '/model-catalog', '/v1/tools', '/tools', '/unknown']) {
                expect(await request(route)).to.equal(401);
            }
            expect(await request('/v1/chat/completions', {}, 'POST')).to.equal(401);
            expect(await request('/v1/messages', {}, 'POST')).to.equal(401);
            expect(await request('/v1/responses', {}, 'POST')).to.equal(401);
            expect(await request('/responses', {}, 'POST')).to.equal(401);
            expect(await request('/v1/responses/compact', {}, 'POST')).to.equal(401);
            expect(await request('/health', { authorization: 'Bearer invalid' })).to.equal(401);
            expect(await request('/health', { authorization: `Bearer ${key}` })).to.equal(200);
            expect(await request('/v1/models', { 'x-api-key': key })).to.equal(200);
            expect(await request('/v1/model-catalog', { 'x-api-key': key })).to.equal(503);
            expect(await request('/health', { origin: 'https://example.com', 'x-api-key': key })).to.equal(403);
            expect(await request('/v1/messages', {}, 'OPTIONS')).to.equal(200);

            await commands.get('copilot-gateway.status')!();
            expect(panel.webview.html).not.to.contain(key);
            expect(panel.webview.html).to.contain('type="password"');
            await bridge({ command: 'updateSetting', key: 'logRequestsToUI', value: true });
            const failedResponse = await fetch(`http://127.0.0.1:${address.port}/responses`, { method: 'POST', headers: { 'x-api-key': key }, body: JSON.stringify({ input: 'Hello' }) });
            expect(failedResponse.status).to.equal(503);
            await failedResponse.text();
            expect(panel.webview.html).to.contain('Request Logs (1)').and.to.contain('No Copilot models available');
            const overview = panel.webview.html.split('<section id="panel-overview"')[1].split('<section id="panel-logs"')[0];
            expect(overview).not.to.contain('logs-table');
            settings.set('responsesBackend', 'direct');
            for (const route of ['/v1/model-catalog', '/model-catalog']) {
                const response = await fetch(`http://127.0.0.1:${address.port}${route}`, { headers: { 'x-api-key': key } });
                expect(response.status).to.equal(200);
                expect(response.headers.get('cache-control')).to.equal('no-store');
                const catalog = await response.json() as { models: Array<{ slug: string; apply_patch_tool_type: string }> };
                expect(catalog.models[0]).to.include({ slug: 'claude-sonnet-5.5', apply_patch_tool_type: 'freeform' });
            }
            const customCatalog = path.join(catalogDirectory, 'custom.json');
            const exportedCatalog = path.join(catalogDirectory, 'exported.json');
            settings.set('codexCatalogPath', customCatalog);
            globalState.set('copilotGateway.codexCatalogExportPath', exportedCatalog);
            await bridge({ command: 'refreshModels' });
            for (const file of ['codex-models.json', 'custom.json', 'exported.json']) {
                expect(JSON.parse(fs.readFileSync(path.join(catalogDirectory, file), 'utf8')).models[0].slug).to.equal('claude-sonnet-5.5');
            }
            const sonnet = await fetch(`http://127.0.0.1:${address.port}/responses`, { method: 'POST', headers: { 'x-api-key': key }, body: JSON.stringify({ model: 'sonnet 5.5', input: 'Hello', stream: true }) });
            const sonnetOutput = await sonnet.text();
            expect(sonnet.status).to.equal(200);
            expect(sonnetOutput).to.contain('response.completed').and.to.contain('Hello from Sonnet');
            expect(upstreamRequests.at(-1)).to.have.property('url', 'https://api.githubcopilot.com/chat/completions');
            expect(upstreamRequests.at(-1)!.body.model).to.equal('claude-sonnet-5.5');
            expect(panel.webview.html).to.contain('Request Logs (2)').and.to.contain('claude-sonnet-5.5').and.to.contain('Success');
            settings.set('responsesBackend', 'vscode');
            const desktop = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, { method: 'POST', headers: { 'x-api-key': key }, body: JSON.stringify({ max_tokens: 1024, messages: [{ role: 'user', content: 'Hello' }, { role: 'system', content: 'Be precise' }] }) });
            expect(desktop.status).to.equal(503); // The fixture has no VS Code models; role validation succeeded.
            expect(await desktop.text()).not.to.contain('role must be one of');
            expect(panel.webview.html).to.contain('Request Logs (3)');
            if (process.env.GATEWAY_UI_PREVIEW) fs.writeFileSync(process.env.GATEWAY_UI_PREVIEW, panel.webview.html.replace('<script>', `<script>
                window.acquireVsCodeApi = () => ({ getState: () => ({ tab: 'logs' }), setState() {}, postMessage() {} });
                </script><style>:root { --vscode-font-family: 'Segoe UI', sans-serif; --vscode-font-size: 13px; --vscode-editor-background: #1f1f1f; --vscode-editor-foreground: #cccccc; --vscode-foreground: #cccccc; --vscode-descriptionForeground: #b5b5b5; --vscode-sideBar-background: #181818; --vscode-textCodeBlock-background: #181818; --vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff; --vscode-textLink-foreground: #4daafc; --vscode-widget-border: #454545; --vscode-input-background: #313131; --vscode-input-foreground: #cccccc; --vscode-focusBorder: #0078d4; }</style><script>`));
            // Execute the actual inline UI script without exposing any real credential.
            const elements = new Map<string, any>();
            const uiMessages: any[] = [];
            const receivers: Array<(event: any) => void> = [];
            let savedState: any = { tab: 'logs' };
            const receive = (event: any) => receivers.forEach(handler => handler(event));
            const element = (id: string) => {
                if (!elements.has(id)) elements.set(id, { value: '', type: 'password', disabled: true,
                    textContent: '', listeners: new Map(), addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); },
                    setAttribute() {}, focus() {}, classList: { add() {}, remove() {} } });
                return elements.get(id);
            };
            vm.runInNewContext(panel.webview.html.match(/<script>([\s\S]*?)<\/script>/)![1], {
                acquireVsCodeApi: () => ({ postMessage: (message: any) => uiMessages.push(message), getState: () => savedState, setState: (state: any) => { savedState = state; } }),
                document: { getElementById: element, querySelectorAll: (selector: string) => selector === '[data-guide-tab]' ? ['overview', 'logs', 'api', 'clients'].map(id => {
                    const tab = element('tab-' + id); tab.dataset = { guideTab: id }; return tab;
                }) : [] },
                window: { addEventListener: (_name: string, callback: typeof receive) => { receivers.push(callback); } }
            });
            const click = (id: string) => element(id).listeners.get('click')();
            expect(element('panel-logs').hidden).to.equal(false);
            expect(element('panel-overview').hidden).to.equal(true);
            click('tab-overview');
            expect(savedState.tab).to.equal('overview');
            click('tab-logs');
            expect(savedState.tab).to.equal('logs');
            await bridge({ command: 'clearLogs' });
            expect(panel.webview.html).to.contain('Request Logs (0)');
            click('copyApiKeyBtn');
            expect(uiMessages.at(-1).command).to.equal('copyApiKey');
            expect(element('apiKeyInput').type).to.equal('password');
            receive({ data: { command: 'apiKeyValue', value: 'ignored-stale-value' } });
            expect(element('apiKeyInput').value).to.equal('');
            click('revealApiKeyBtn');
            receive({ data: { command: 'apiKeyValue', value: 'synthetic-ui-test-key' } });
            expect(element('apiKeyInput').type).to.equal('text');
            click('revealApiKeyBtn');
            expect(element('apiKeyInput').type).to.equal('password');
            element('apiKeyInput').value = 'synthetic-pasted-test-key';
            element('apiKeyInput').listeners.get('input')();
            expect(element('saveApiKeyBtn').disabled).to.equal(false);
            click('saveApiKeyBtn');
            expect(uiMessages.at(-1).value).to.equal('synthetic-pasted-test-key');
            receive({ data: { command: 'apiKeyResult', saved: true, text: 'Saved' } });
            expect(element('apiKeyInput').type).to.equal('password');
            expect(element('apiKeyInput').value).to.equal('');
            expect(element('saveApiKeyBtn').disabled).to.equal(true);
            await bridge({ command: 'copyApiKey' });
            expect(clipboard).to.equal(key);
            expect(messages.some(message => message.command === 'apiKeyValue')).to.equal(false);
            await bridge({ command: 'revealApiKey' });
            expect(messages.at(-1).value).to.equal(key);
            const replacement = 'pasted-client-key-123456';
            confirmation = undefined;
            await bridge({ command: 'saveApiKey', value: replacement });
            expect(await request('/health', { 'x-api-key': key })).to.equal(200);
            confirmation = 'Replace Key';
            failStorage = true;
            await bridge({ command: 'saveApiKey', value: replacement });
            expect(await request('/health', { 'x-api-key': key })).to.equal(200);
            failStorage = false;
            await bridge({ command: 'saveApiKey', value: replacement });
            expect(await request('/health', { 'x-api-key': key })).to.equal(401);
            expect(await request('/health', { 'x-api-key': replacement })).to.equal(200);
            await bridge({ command: 'generateApiKey' });
            await bridge({ command: 'copyApiKey' });
            expect(clipboard).not.to.equal(replacement);
            expect(await request('/health', { 'x-api-key': replacement })).to.equal(401);
            expect(await request('/health', { 'x-api-key': clipboard })).to.equal(200);
            expect(logs.join('\n')).not.to.contain(key).and.not.to.contain(replacement).and.not.to.contain(clipboard);
            selectableModels = ['claude-sonnet-5.5', 'gpt-6.1-sol', 'gemini-4-argon'].map(id => ({ id, name: id, maxInputTokens: 32000 }));
            confirmation = undefined; // Review is cancelled, so no real Desktop configuration is written.
            await commands.get('copilot-gateway.setupClaudeGateway')!();
            expect(offeredModels.map(choices => choices.length)).to.deep.equal([3, 2, 1]);
            expect(confirmations.at(-1)).to.contain('Label: claude-sonnet-5.5').and.to.contain('Label: gpt-6.1-sol').and.to.contain('Label: gemini-4-argon');
            expect(globalState.has('copilotGateway.claudeDesktopModels')).to.equal(false);
            const reviewCount = confirmations.length;
            cancelLabel = true;
            await commands.get('copilot-gateway.setupClaudeGateway')!();
            expect(confirmations.length).to.equal(reviewCount);
        } finally {
            exported.deactivate();
            fs.rmSync(catalogDirectory, { recursive: true, force: true });
        }
    });
});
