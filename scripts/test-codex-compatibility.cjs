// An actual Codex read/patch/result workflow against a deterministic local gateway.
// No Copilot inference, personal config edits, or model-selected commands outside the fixture.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { handleResponses } = require('../out/responses/handler');
const { codexCatalog } = require('../out/responses/catalog');

(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-gateway-codex-'));
    const clientHome = path.join(directory, 'codex-home');
    fs.mkdirSync(clientHome);
    fs.writeFileSync(path.join(directory, 'fixture.txt'), 'before\n');
    const model = { id: 'fixture-model', name: 'Fixture model', contextWindow: 32000,
        capabilities: { images: false, tools: true, generationControls: false, usage: 'estimated' } };
    const catalog = path.join(directory, 'models.json');
    fs.writeFileSync(catalog, JSON.stringify(codexCatalog([model])));
    const key = randomBytes(24).toString('hex');
    let step = 0;
    const observed = [];
    const infer = async function* (turn) {
        observed.push({ step, tools: turn.tools.map(tool => tool.wireName || tool.name), history: turn.messages.map(message => message.parts.map(part => part.kind)) });
        if (step === 0) {
            const tool = turn.tools.find(tool => ['exec_command', 'shell_command'].includes(tool.wireName || tool.name));
            if (!tool) throw new Error('Missing Codex shell tool');
            const input = (tool.wireName || tool.name) === 'exec_command' ? { cmd: "Get-Content -LiteralPath 'fixture.txt'" } : { command: "Get-Content -LiteralPath 'fixture.txt'" };
            yield { kind: 'tool', index: 0, id: 'fixture-read', name: tool.name, arguments: JSON.stringify(input) };
        } else if (step === 1) {
            const tool = turn.tools.find(tool => (tool.wireName || tool.name) === 'apply_patch');
            if (!tool) throw new Error('Missing Codex freeform apply_patch tool');
            const input = '*** Begin Patch\n*** Update File: fixture.txt\n@@\n-before\n+after\n*** End Patch';
            yield { kind: 'tool', index: 0, id: 'fixture-patch', name: tool.name, arguments: JSON.stringify({ input }) };
        } else yield { kind: 'text', text: 'Updated fixture.txt from before to after.' };
        yield { kind: 'finish', reason: step < 2 ? 'tool_calls' : 'stop' };
        step++;
    };
    const server = http.createServer((req, res) => {
        if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; }
        void handleResponses(req, res, {}, infer);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/v1`;
    const config = `model = "fixture-model"\nmodel_provider = "copilot_gateway"\nweb_search = "disabled"\nmodel_catalog_json = ${JSON.stringify(catalog)}\n[model_providers.copilot_gateway]\nname = "Fixture gateway"\nbase_url = ${JSON.stringify(base)}\nwire_api = "responses"\nenv_key = "COPILOT_GATEWAY_KEY"\nsupports_websockets = false\nrequires_openai_auth = false\n[model_providers.copilot_gateway.capabilities]\nremote_compaction = "unsupported"\n`;
    fs.writeFileSync(path.join(clientHome, 'config.toml'), config);
    try {
        const args = ['-a', 'never', 'exec', '--skip-git-repo-check', '--sandbox', 'danger-full-access', '--cd', directory,
            'Read fixture.txt, use apply_patch to change before to after, and report completion. This is an isolated integration-test workspace.'];
        const result = await new Promise((resolve, reject) => {
            const child = spawn(process.argv[2] || 'codex', args, { cwd: directory, windowsHide: true,
                env: { ...process.env, CODEX_HOME: clientHome, COPILOT_GATEWAY_KEY: key } });
            child.stdin.end();
            let output = '';
            child.stdout.on('data', bytes => { output += bytes; });
            child.stderr.on('data', bytes => { output += bytes; });
            const timer = setTimeout(() => child.kill(), 90000);
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('exit', code => { clearTimeout(timer); resolve({ code, output: output.slice(-12000).split(key).join('[redacted]') }); });
        });
        const content = fs.readFileSync(path.join(directory, 'fixture.txt'), 'utf8');
        const report = { directory, code: result.code, steps: step, content, observed, output: result.output,
            success: result.code === 0 && step >= 3 && content.trim() === 'after' };
        const reportPath = path.resolve(__dirname, '../docs/recovery/codex-client-validation.json');
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ success: report.success, code: report.code, steps: step, content, reportPath, output: result.output.slice(-2000) }, null, 2));
        if (!report.success) process.exitCode = 1;
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
