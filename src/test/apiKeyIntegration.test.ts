import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as http from 'http';
import * as ts from 'typescript';

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
        const panel = {
            webview: { html: '', postMessage(message: any) { messages.push(message); }, onDidReceiveMessage(handler: typeof bridge) { bridge = handler; } },
            onDidDispose() {}, reveal() {}, dispose() {}
        };
        const output = { info: (text: string) => logs.push(text), warn: (text: string) => logs.push(text),
            error: (text: string) => logs.push(text), debug: (text: string) => logs.push(text), dispose() {} };
        const vscode = {
            workspace: { getConfiguration: () => ({ get: (name: string, fallback: unknown) => name === 'autoStart' ? false : name === 'port' ? 0 : fallback }) },
            window: {
                createOutputChannel: () => output,
                createStatusBarItem: () => ({ show() {}, dispose() {} }),
                createWebviewPanel: () => panel,
                showInformationMessage: async () => undefined,
                showErrorMessage: async () => undefined,
                showWarningMessage: async () => confirmation
            },
            commands: { registerCommand(name: string, handler: () => unknown) { commands.set(name, handler); return { dispose() {} }; } },
            lm: { onDidChangeChatModels: () => ({ dispose() {} }), selectChatModels: async () => [], tools: [] },
            StatusBarAlignment: { Right: 1 }, ViewColumn: { One: 1 },
            env: { clipboard: { async writeText(value: string) { clipboard = value; } } }
        };
        const exported: any = {};
        const source = fs.readFileSync(path.join(__dirname, '../extension.ts'), 'utf8');
        const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
        vm.runInNewContext(compiled, {
            exports: exported, Buffer, console: { log() {}, warn() {}, error() {} },
            setTimeout: (callback: () => void, delay: number) => { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
            clearTimeout,
            require: (name: string) => name === 'vscode' ? vscode : name === 'http' ? {
                ...http, createServer: (handler: http.RequestListener) => { server = http.createServer(handler); return server; }
            } : require(name.startsWith('./') ? `../${name.slice(2)}` : name)
        });
        exported.activate({
            subscriptions: [], extension: { packageJSON: { version: 'test' } },
            globalState: { get() {}, update() {} },
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
            for (const route of ['/health', '/', '/v1/models', '/models', '/v1/tools', '/tools', '/unknown']) {
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
            expect(await request('/health', { origin: 'https://example.com', 'x-api-key': key })).to.equal(403);
            expect(await request('/v1/messages', {}, 'OPTIONS')).to.equal(200);

            await commands.get('copilot-gateway.status')!();
            expect(panel.webview.html).not.to.contain(key);
            expect(panel.webview.html).to.contain('type="password"');
            // Execute the actual inline UI script without exposing any real credential.
            const elements = new Map<string, any>();
            const uiMessages: any[] = [];
            const receivers: Array<(event: any) => void> = [];
            const receive = (event: any) => receivers.forEach(handler => handler(event));
            const element = (id: string) => {
                if (!elements.has(id)) elements.set(id, { value: '', type: 'password', disabled: true,
                    textContent: '', listeners: new Map(), addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); },
                    setAttribute() {}, classList: { add() {}, remove() {} } });
                return elements.get(id);
            };
            vm.runInNewContext(panel.webview.html.match(/<script>([\s\S]*?)<\/script>/)![1], {
                acquireVsCodeApi: () => ({ postMessage: (message: any) => uiMessages.push(message) }),
                document: { getElementById: element, querySelectorAll: () => [] },
                window: { addEventListener: (_name: string, callback: typeof receive) => { receivers.push(callback); } }
            });
            const click = (id: string) => element(id).listeners.get('click')();
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
        } finally {
            exported.deactivate();
        }
    });
});
