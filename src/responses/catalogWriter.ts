import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { codexCatalog } from './catalog';
import { Model } from './types';

/** Serialize updates and replace atomically so Codex never reads partial JSON.
 * Empty discovery during sign-in/reload must not erase the last usable catalog.
 */
export class CatalogWriter {
    private pending: Promise<void> = Promise.resolve();
    update(destination: string, models: Model[]): Promise<void> {
        const content = JSON.stringify(codexCatalog(models), null, 2) + '\n';
        if (!models.some(model => model.kind !== 'embedding')) return this.pending;
        const operation = this.pending.catch(() => {}).then(async () => {
            const previous = await fs.readFile(destination, 'utf8').catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
                throw error;
            });
            if (previous === content) return;
            await fs.mkdir(path.dirname(destination), { recursive: true });
            const temporary = destination + '.' + randomUUID() + '.tmp';
            try {
                await fs.writeFile(temporary, content, { mode: 0o600 });
                await fs.rename(temporary, destination);
            } finally { await fs.rm(temporary, { force: true }); }
        });
        this.pending = operation;
        return operation;
    }
}
