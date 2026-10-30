// @vitest-environment node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { startCompiledPersistenceServer } from '../compiledPersistenceServer';
import { isBuiltE2eShardRun } from '../e2eServerIdentity';

const vite = vi.hoisted(() => ({
    build: vi.fn<(config: import('vite').InlineConfig) => Promise<void>>(),
    preview: vi.fn<
        (config: import('vite').InlineConfig) => Promise<{
            httpServer: { address: () => { port: number } | null };
            close: () => Promise<void>;
        }>
    >(),
    close: vi.fn<() => Promise<void>>(),
}));
vi.mock('vite', () => ({ build: vite.build, preview: vite.preview }));

beforeEach(() => {
    vi.clearAllMocks();
    vite.build.mockResolvedValue(undefined);
    vite.close.mockResolvedValue(undefined);
    vite.preview.mockResolvedValue({ httpServer: { address: () => ({ port: 43210 }) }, close: vite.close });
});

describe('selected persistence acceptance server', () => {
    it('reuses only the existing built-shard profile, including an empty selected cohort', () => {
        expect(isBuiltE2eShardRun({ CI: 'true', E2E_SPECS: '[]' })).toBe(true);
        expect(isBuiltE2eShardRun({ CI: 'true' })).toBe(false);
        expect(isBuiltE2eShardRun({ E2E_SPECS: '[]' })).toBe(false);
        expect(isBuiltE2eShardRun({})).toBe(false);
    });

    it('builds one e2e graph, previews that same directory on an exclusive OS-assigned port, and removes it after close', async () => {
        const root = resolve(import.meta.dirname, '../..');
        const server = await startCompiledPersistenceServer(root);
        const [buildConfig] = vite.build.mock.calls[0];
        expect(vite.build).toHaveBeenCalledOnce();
        expect(buildConfig).toMatchObject({ root, configFile: resolve(root, 'vite.config.ts'), mode: 'e2e' });
        expect(existsSync(buildConfig.build!.outDir!)).toBe(true);
        expect(vite.preview).toHaveBeenCalledExactlyOnceWith({
            ...buildConfig,
            preview: { host: '127.0.0.1', port: 0, strictPort: true },
        });
        expect(vite.build.mock.invocationCallOrder[0]).toBeLessThan(vite.preview.mock.invocationCallOrder[0]);
        expect(server.origin).toBe('http://127.0.0.1:43210');
        await server.close();
        expect(vite.close).toHaveBeenCalledOnce();
        expect(existsSync(buildConfig.build!.outDir!)).toBe(false);
    });

    it('never starts preview after a failed build and preserves the build failure', async () => {
        const error = new Error('fixture build failed');
        vite.build.mockRejectedValue(error);
        await expect(startCompiledPersistenceServer(resolve(import.meta.dirname, '../..'))).rejects.toBe(error);
        expect(vite.preview).not.toHaveBeenCalled();
        const [buildConfig] = vite.build.mock.calls[0];
        expect(existsSync(buildConfig.build!.outDir!)).toBe(false);
    });

    it('closes an invalid listener and removes its output before refusing admission', async () => {
        vite.preview.mockResolvedValue({ httpServer: { address: () => null }, close: vite.close });
        await expect(startCompiledPersistenceServer(resolve(import.meta.dirname, '../..'))).rejects.toThrow(
            'Compiled persistence preview has no TCP listener'
        );
        expect(vite.close).toHaveBeenCalledOnce();
        const [buildConfig] = vite.build.mock.calls[0];
        expect(existsSync(buildConfig.build!.outDir!)).toBe(false);
    });
});
