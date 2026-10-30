import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Gateway schema documented by mohitsoni48/Claude-Desktop-Router/setup-claude-gateway.py.
export const GATEWAY_ID = '00000000-0000-4000-8000-000000000114';
const files = ['claude_desktop_config.json', `configLibrary/${GATEWAY_ID}.json`, 'configLibrary/_meta.json'];
const backupName = '.copilot-proxy-gateway-backup.json';
type Snapshot = Record<string, string | null>;

async function readOptional(file: string): Promise<string | null> {
    try { return await fs.readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function object(text: string | null): Record<string, unknown> {
    const value = text === null ? {} : JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON configuration object');
    return value;
}

async function write(file: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, { mode: 0o600 });
}

async function restoreSnapshot(dir: string, snapshot: Snapshot): Promise<void> {
    for (const name of files) {
        if (snapshot[name] === null) await fs.rm(path.join(dir, name), { force: true });
        else await write(path.join(dir, name), snapshot[name]!);
    }
}

export async function getClaudeGatewayDirectories(system = process.platform, home = os.homedir(), local = process.env.LOCALAPPDATA): Promise<string[]> {
    if (system === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude-3p')];
    if (system === 'linux') return [path.join(home, '.config', 'Claude-3p')];
    if (system !== 'win32') throw new Error('Unsupported operating system');
    const appData = local || path.join(home, 'AppData', 'Local');
    const legacy = path.join(appData, 'Claude-3p');
    let packages: string[] = [];
    try {
        packages = (await fs.readdir(path.join(appData, 'Packages'), { withFileTypes: true }))
            .filter(entry => entry.isDirectory() && entry.name.startsWith('Claude_'))
            .map(entry => path.join(appData, 'Packages', entry.name, 'LocalCache', 'Roaming', 'Claude-3p'));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // Store installs may not have created their third-party directory yet.
    const legacyExists = await fs.stat(legacy).then(stat => stat.isDirectory(), () => false);
    return [...(legacyExists || !packages.length ? [legacy] : []), ...packages];
}

export async function setupClaudeGateway(dir: string, baseUrl: string, apiKey: string, model: string): Promise<void> {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid gateway URL');
    if (!apiKey.trim() || !model.trim()) throw new Error('A saved key and model ID are required');
    const current: Snapshot = {};
    for (const name of files) current[name] = await readOptional(path.join(dir, name));
    // Parse everything before modifying files; malformed configurations are never overwritten.
    const desktop = object(current[files[0]]);
    const gateway = object(current[files[1]]);
    const meta = object(current[files[2]]);
    if (meta.entries !== undefined && !Array.isArray(meta.entries)) throw new Error('Invalid gateway registry');
    const entries = (meta.entries as Record<string, unknown>[] | undefined) || [];
    if (entries.some(entry => !entry || typeof entry !== 'object')) throw new Error('Invalid gateway registry entry');
    const backup = path.join(dir, backupName);
    if (await readOptional(backup) === null) await write(backup, JSON.stringify(current, null, 2));
    const updates = [
        { ...desktop, deploymentMode: '3p' },
        { ...gateway, inferenceProvider: 'gateway', inferenceCredentialKind: 'static',
            inferenceGatewayApiKey: apiKey, inferenceGatewayAuthScheme: 'bearer',
            inferenceGatewayBaseUrl: baseUrl.replace(/\/+$/, '') + '/',
            inferenceModels: [{ name: model, labelOverride: model }] },
        { ...meta, appliedId: GATEWAY_ID, entries: [...entries.filter(entry => entry.id !== GATEWAY_ID), { id: GATEWAY_ID, name: model }] }
    ];
    try {
        for (let i = 0; i < files.length; i++) await write(path.join(dir, files[i]), JSON.stringify(updates[i], null, 2) + '\n');
    } catch (error) {
        await restoreSnapshot(dir, current);
        throw error;
    }
}

export async function restoreClaudeGateway(dir: string): Promise<boolean> {
    const backup = path.join(dir, backupName);
    const text = await readOptional(backup);
    if (text === null) return false;
    const snapshot = object(text);
    for (const name of files) {
        if (snapshot[name] !== null && typeof snapshot[name] !== 'string') throw new Error('Invalid gateway backup');
    }
    await restoreSnapshot(dir, snapshot as Snapshot);
    await fs.rm(backup);
    return true;
}
