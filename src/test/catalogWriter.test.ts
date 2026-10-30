import { expect } from 'chai';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CatalogWriter } from '../responses/catalogWriter';
import { Model } from '../responses/types';

describe('Automatic Codex catalog file', () => {
    let directory: string;
    beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-catalog-')); });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
    const models = (id: string): Model[] => [{ id, name: id, contextWindow: 12345,
        capabilities: { images: false, tools: true, generationControls: false, usage: 'estimated' } }];
    it('creates, updates and serializes catalogs without leaving partial files', async () => {
        const writer = new CatalogWriter();
        const destination = path.join(directory, 'nested', 'catalog.json');
        await Promise.all([writer.update(destination, models('old')), writer.update(destination, models('new'))]);
        const saved = JSON.parse(await fs.readFile(destination, 'utf8'));
        expect(saved.models[0]).to.include({ slug: 'new', context_window: 12345, apply_patch_tool_type: 'freeform' });
        expect(saved.models[0].input_modalities).to.deep.equal(['text']);
        expect(await fs.readdir(path.dirname(destination))).to.deep.equal(['catalog.json']);
        const before = (await fs.stat(destination)).mtimeMs;
        await writer.update(destination, models('new'));
        expect((await fs.stat(destination)).mtimeMs).to.equal(before);
        await writer.update(destination, []);
        expect(JSON.parse(await fs.readFile(destination, 'utf8')).models[0].slug).to.equal('new');
    });
    it('advertises only known upstream reasoning efforts', async () => {
        const writer = new CatalogWriter();
        const destination = path.join(directory, 'reasoning.json');
        await writer.update(destination, [{ ...models('r')[0], reasoningEfforts: ['low', 'medium', 'high', 'bogus'] }, models('plain')[0]]);
        const [reasoning, plain] = JSON.parse(await fs.readFile(destination, 'utf8')).models;
        expect(reasoning.supported_reasoning_levels.map((l: { effort: string }) => l.effort)).to.deep.equal(['low', 'medium', 'high']);
        expect(reasoning.default_reasoning_level).to.equal('medium');
        expect(plain.supported_reasoning_levels).to.deep.equal([]);
        expect(plain.default_reasoning_level).to.equal(null);
    });
    it('recovers from a failed destination and leaves the last valid catalog untouched', async () => {
        const writer = new CatalogWriter();
        const destination = path.join(directory, 'catalog.json');
        await writer.update(destination, models('old'));
        try { await writer.update(directory, models('new')); throw new Error('Expected failure'); }
        catch (error) { expect((error as NodeJS.ErrnoException).code).to.be.a('string'); }
        expect(JSON.parse(await fs.readFile(destination, 'utf8')).models[0].slug).to.equal('old');
        await writer.update(destination, models('recovered'));
        expect(JSON.parse(await fs.readFile(destination, 'utf8')).models[0].slug).to.equal('recovered');
    });
});
