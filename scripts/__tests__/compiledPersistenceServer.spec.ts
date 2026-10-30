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

function recordedBuild(): { config: import('vite').InlineConfig; outDir: string } {
    const config = vite.build.mock.calls[0]?.[0];
    const outDir = config?.build?.outDir;
    if (config === undefined || typeof outDir !== 'string') {
        throw new Error('Expected one real build configuration with its output directory');
    }
    return { config, outDir };
}

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
        const { config: buildConfig, outDir } = recordedBuild();
        expect(vite.build).toHaveBeenCalledOnce();
        expect(buildConfig).toMatchObject({ root, configFile: resolve(root, 'vite.config.ts'), mode: 'e2e' });
        expect(existsSync(outDir)).toBe(true);
        expect(vite.preview).toHaveBeenCalledExactlyOnceWith({
            ...buildConfig,
            preview: { host: '127.0.0.1', port: 0, strictPort: true },
        });
        const buildOrder = vite.build.mock.invocationCallOrder[0];
        const previewOrder = vite.preview.mock.invocationCallOrder[0];
        if (typeof buildOrder !== 'number' || typeof previewOrder !== 'number') {
            throw new TypeError('Build and preview must both be observed');
        }
        expect(buildOrder).toBeLessThan(previewOrder);
        expect(server.origin).toBe('http://127.0.0.1:43210');
        await server.close();
        expect(vite.close).toHaveBeenCalledOnce();
        expect(existsSync(outDir)).toBe(false);
    });

    it('never starts preview after a failed build and preserves the build failure', async () => {
        const error = new Error('fixture build failed');
        vite.build.mockRejectedValue(error);
        await expect(startCompiledPersistenceServer(resolve(import.meta.dirname, '../..'))).rejects.toBe(error);
        expect(vite.preview).not.toHaveBeenCalled();
        const { outDir } = recordedBuild();
        expect(existsSync(outDir)).toBe(false);
    });

    it('closes an invalid listener and removes its output before refusing admission', async () => {
        vite.preview.mockResolvedValue({ httpServer: { address: () => null }, close: vite.close });
        await expect(startCompiledPersistenceServer(resolve(import.meta.dirname, '../..'))).rejects.toThrow(
            'Compiled persistence preview has no TCP listener'
        );
        expect(vite.close).toHaveBeenCalledOnce();
        const { outDir } = recordedBuild();
        expect(existsSync(outDir)).toBe(false);
    });

    it('preserves both startup and cleanup failures, chains the caught cleanup cause, and still removes output', async () => {
        const startupError = new Error('listener address failed');
        const cleanupError = new Error('preview close failed');
        vite.preview.mockResolvedValue({
            httpServer: {
                address: () => {
                    throw startupError;
                },
            },
            close: vite.close,
        });
        vite.close.mockRejectedValue(cleanupError);
        const failure: unknown = await startCompiledPersistenceServer(resolve(import.meta.dirname, '../..')).then(
            () => null,
            (error: unknown) => error
        );
        if (!(failure instanceof AggregateError)) {
            throw new TypeError('Expected the actual combined startup and cleanup failure', { cause: failure });
        }
        expect(failure.errors).toHaveLength(2);
        expect(failure.errors[0]).toBe(startupError);
        expect(failure.errors[1]).toBe(cleanupError);
        expect(failure.cause).toBe(cleanupError);
        expect(vite.close).toHaveBeenCalledOnce();
        expect(existsSync(recordedBuild().outDir)).toBe(false);
    });
});
