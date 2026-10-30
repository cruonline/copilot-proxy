import { expect } from 'chai';
import { ApiKeyManager, API_KEY_SECRET, generateApiKey, validateApiKey } from '../apiKey';

describe('API key management', () => {
    function storage(initial?: string) {
        let value = initial;
        return {
            fail: false,
            writes: 0,
            async get(name: string) { expect(name).to.equal(API_KEY_SECRET); return value; },
            async store(name: string, key: string) {
                expect(name).to.equal(API_KEY_SECRET);
                this.writes++;
                if (this.fail) throw new Error('Storage unavailable');
                value = key;
            }
        };
    }

    it('generates random keys and persists once across concurrent initialization and reload', async () => {
        const store = storage();
        const manager = new ApiKeyManager(store);
        expect(manager.accepts({})).to.equal(false);
        await Promise.all([manager.initialize(), manager.initialize()]);
        expect(manager.savedKey).to.match(/^sk-copilot-[a-f0-9]{64}$/);
        expect(manager.savedKey).not.to.equal(generateApiKey());
        const reloaded = new ApiKeyManager(store);
        await reloaded.initialize();
        expect(reloaded.savedKey).to.equal(manager.savedKey);
        expect(store.writes).to.equal(1);
    });

    it('fails closed on initial storage failure and permits retry', async () => {
        const store = storage();
        store.fail = true;
        const manager = new ApiKeyManager(store);
        let rejected = false;
        try { await manager.initialize(); } catch { rejected = true; }
        expect(rejected).to.equal(true);
        expect(manager.savedKey).to.equal(undefined);
        expect(manager.accepts({ authorization: `Bearer ${generateApiKey()}` })).to.equal(false);
        store.fail = false;
        await manager.initialize();
        expect(manager.savedKey).to.be.a('string');
    });

    it('accepts either header, rejects malformed or missing credentials and rotates immediately', async () => {
        const oldKey = generateApiKey();
        const store = storage(oldKey);
        const manager = new ApiKeyManager(store);
        await manager.initialize();
        expect(manager.accepts({ authorization: `Bearer ${oldKey}` })).to.equal(true);
        expect(manager.accepts({ 'x-api-key': oldKey })).to.equal(true);
        for (const headers of [{}, { authorization: oldKey }, { authorization: 'Bearer wrong' },
            { 'x-api-key': ['ambiguous', oldKey] }, { authorization: `Bearer ${oldKey} ` }]) {
            expect(manager.accepts(headers)).to.equal(false);
        }
        store.fail = true;
        let rejected = false;
        try { await manager.replace(generateApiKey()); } catch { rejected = true; }
        expect(rejected).to.equal(true);
        expect(manager.savedKey).to.equal(oldKey);
        store.fail = false;
        const newKey = generateApiKey();
        await manager.replace(newKey);
        expect(manager.accepts({ 'x-api-key': oldKey })).to.equal(false);
        expect(manager.accepts({ authorization: `Bearer ${newKey}` })).to.equal(true);
    });

    it('rejects empty, short, oversized, whitespace and non-ASCII pasted keys', () => {
        for (const value of ['', 'short', 'x'.repeat(257), 'x'.repeat(16) + '\n', 'contains spaces in key', 'ą'.repeat(20), undefined]) {
            expect(() => validateApiKey(value)).to.throw();
        }
        expect(() => validateApiKey('pasted-client-key-123456')).not.to.throw();
    });
});
