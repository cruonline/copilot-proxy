import { randomBytes, timingSafeEqual } from 'crypto';
import { IncomingHttpHeaders } from 'http';

export const API_KEY_SECRET = 'copilotGateway.apiKey';

export interface KeyStorage {
    get(key: string): Thenable<string | undefined>;
    store(key: string, value: string): Thenable<void>;
}

/** Persist before exposing a key to callers. Failed writes never replace a working key. */
export class ApiKeyManager {
    private key: string | undefined;
    private initialization: Promise<void> | undefined;

    constructor(private readonly storage: KeyStorage) {}

    initialize(): Promise<void> {
        if (!this.initialization) {
            this.initialization = this.load().catch(error => {
                this.initialization = undefined;
                throw error;
            });
        }
        return this.initialization;
    }

    private async load(): Promise<void> {
        const stored = await this.storage.get(API_KEY_SECRET);
        if (stored) {
            validateApiKey(stored);
            this.key = stored;
        } else {
            await this.replace(generateApiKey());
        }
    }

    get savedKey(): string | undefined { return this.key; }

    async replace(value: string): Promise<void> {
        validateApiKey(value);
        await this.storage.store(API_KEY_SECRET, value);
        this.key = value;
    }

    accepts(headers: IncomingHttpHeaders): boolean {
        if (!this.key) return false;
        const bearer = typeof headers.authorization === 'string'
            ? /^Bearer ([\x21-\x7e]+)$/i.exec(headers.authorization)?.[1] : undefined;
        const apiKey = typeof headers['x-api-key'] === 'string' ? headers['x-api-key'] : undefined;
        return [bearer, apiKey].some(candidate => {
            if (!candidate) return false;
            const actual = Buffer.from(candidate);
            const expected = Buffer.from(this.key!);
            return actual.length === expected.length && timingSafeEqual(actual, expected);
        });
    }
}

export function generateApiKey(): string {
    return `sk-copilot-${randomBytes(32).toString('hex')}`;
}

export function validateApiKey(value: unknown): asserts value is string {
    if (typeof value !== 'string' || !/^[\x21-\x7e]{16,256}$/.test(value)) {
        throw new Error('Use 16-256 visible ASCII characters without spaces.');
    }
}
