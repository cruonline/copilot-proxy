import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GATEWAY_ID, getClaudeGatewayDirectories, setupClaudeGateway, restoreClaudeGateway } from '../claudeGateway';

describe('Claude Desktop gateway configuration', () => {
    let dir: string;
    beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-gateway-test-')); });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it('preserves preferences and registry entries, retains the first backup across key rotation, and restores exact originals', async () => {
        const desktop = '{"mcpServers":{"test":{}},"deploymentMode":"original"}\n';
        const registry = '{"appliedId":"other","entries":[{"id":"other","name":"Other"}],"extra":true}';
        await fs.mkdir(path.join(dir, 'configLibrary'));
        await fs.writeFile(path.join(dir, 'claude_desktop_config.json'), desktop);
        await fs.writeFile(path.join(dir, 'configLibrary', '_meta.json'), registry);
        await fs.writeFile(path.join(dir, 'configLibrary', 'other.json'), 'untouched');
        await setupClaudeGateway(dir, 'http://127.0.0.1:9123', 'first-secret', 'model-a');
        await setupClaudeGateway(dir, 'http://127.0.0.1:9123/', 'second-secret', 'model-b');
        const gateway = JSON.parse(await fs.readFile(path.join(dir, 'configLibrary', `${GATEWAY_ID}.json`), 'utf8'));
        expect(gateway.inferenceGatewayApiKey).to.equal('second-secret');
        expect(gateway.inferenceGatewayBaseUrl).to.equal('http://127.0.0.1:9123/');
        expect(gateway.inferenceModels).to.deep.equal([{ name: 'model-b', labelOverride: 'model-b' }]);
        const meta = JSON.parse(await fs.readFile(path.join(dir, 'configLibrary', '_meta.json'), 'utf8'));
        expect(meta.entries).to.have.length(2);
        expect(meta.entries[0].id).to.equal('other');
        expect(await restoreClaudeGateway(dir)).to.equal(true);
        expect(await fs.readFile(path.join(dir, 'claude_desktop_config.json'), 'utf8')).to.equal(desktop);
        expect(await fs.readFile(path.join(dir, 'configLibrary', '_meta.json'), 'utf8')).to.equal(registry);
        expect(await fs.readFile(path.join(dir, 'configLibrary', 'other.json'), 'utf8')).to.equal('untouched');
        expect(await restoreClaudeGateway(dir)).to.equal(false);
    });

    it('does not overwrite malformed existing configuration', async () => {
        await fs.writeFile(path.join(dir, 'claude_desktop_config.json'), 'broken JSON');
        let failed = false;
        try { await setupClaudeGateway(dir, 'http://localhost:8080', 'secret', 'model'); } catch { failed = true; }
        expect(failed).to.equal(true);
        expect(await fs.readFile(path.join(dir, 'claude_desktop_config.json'), 'utf8')).to.equal('broken JSON');
        expect(await restoreClaudeGateway(dir)).to.equal(false);
    });

    it('finds fresh Windows Store installs and resolves macOS/Linux locations', async () => {
        await fs.mkdir(path.join(dir, 'Packages', 'Claude_test'), { recursive: true });
        expect(await getClaudeGatewayDirectories('win32', dir, dir)).to.deep.equal([
            path.join(dir, 'Packages', 'Claude_test', 'LocalCache', 'Roaming', 'Claude-3p')
        ]);
        expect(await getClaudeGatewayDirectories('darwin', dir)).to.deep.equal([path.join(dir, 'Library', 'Application Support', 'Claude-3p')]);
        expect(await getClaudeGatewayDirectories('linux', dir)).to.deep.equal([path.join(dir, '.config', 'Claude-3p')]);
    });

    it('restores a fresh setup without deleting unrelated library files', async () => {
        await setupClaudeGateway(dir, 'http://localhost:8080', 'secret', 'model');
        await fs.writeFile(path.join(dir, 'configLibrary', 'unrelated.json'), '{}');
        await restoreClaudeGateway(dir);
        expect(await fs.readFile(path.join(dir, 'configLibrary', 'unrelated.json'), 'utf8')).to.equal('{}');
        expect(await fs.stat(path.join(dir, 'claude_desktop_config.json')).then(() => true, () => false)).to.equal(false);
    });
});
