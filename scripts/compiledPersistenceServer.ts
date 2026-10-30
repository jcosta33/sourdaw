import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { build, preview, type PreviewServer } from 'vite';

export type CompiledPersistenceServer = { origin: string; close: () => Promise<void> };

/** Used only by the selected persistence spec when no built shard exists. */
export async function startCompiledPersistenceServer(root: string): Promise<CompiledPersistenceServer> {
    const outDir = await mkdtemp(join(tmpdir(), 'sourdaw-persisted-'));
    let server: PreviewServer | undefined;
    const close = async (): Promise<void> => {
        try {
            await server?.close();
        } finally {
            await rm(outDir, { recursive: true, force: true });
        }
    };
    try {
        const config = { root, configFile: resolve(root, 'vite.config.ts'), mode: 'e2e', build: { outDir } };
        await build(config);
        server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
        const address = server.httpServer.address();
        if (address === null || typeof address === 'string') {
            throw new Error('Compiled persistence preview has no TCP listener');
        }
        return { origin: `http://127.0.0.1:${address.port}`, close };
    } catch (error) {
        try {
            await close();
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Compiled persistence startup and cleanup failed', {
                cause: error,
            });
        }
        throw error;
    }
}
