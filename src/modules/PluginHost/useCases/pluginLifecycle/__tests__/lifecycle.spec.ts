import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadPlugin } from '../loadPlugin';
import { openPluginGui } from '../openPluginGui';
import { unloadPlugin } from '../unloadPlugin';

const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn(),
    unloadPluginRepo: vi.fn(),
    openPluginGuiRepo: vi.fn(),
}));

const pluginInstance = {
    instance_id: 'inst1',
    plugin_id: 'p1',
    name: 'Plugin',
    parameters: [],
    is_active: true,
    latency_samples: 0,
};

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({
    loadPlugin: mocks.loadPluginRepo,
}));

vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({
    unloadPlugin: mocks.unloadPluginRepo,
}));

vi.mock('../../../repositories/pluginBridge/openPluginGui', () => ({
    openPluginGui: mocks.openPluginGuiRepo,
}));

describe('Plugin Lifecycle Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadPluginRepo.mockResolvedValue(pluginInstance);
        mocks.unloadPluginRepo.mockResolvedValue(undefined);
    });

    it('loadPlugin delegates to repository', async () => {
        await loadPlugin('p1', 'inst1');
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'inst1');
    });

    it('unloadPlugin delegates to repository', async () => {
        await unloadPlugin('inst1');
        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith('inst1');
    });

    it('serializes unload then load for the same instance', async () => {
        const unloading = Promise.withResolvers<void>();
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);

        const unloadResult = unloadPlugin('ordered-instance');
        const loadResult = loadPlugin('p1', 'ordered-instance');

        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith('ordered-instance');
        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();

        unloading.resolve();
        await Promise.all([unloadResult, loadResult]);

        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'ordered-instance');
        expect(mocks.unloadPluginRepo.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadPluginRepo.mock.invocationCallOrder[0]!
        );
    });

    it('allows a different instance to progress while an unload is pending and then fails', async () => {
        const unloading = Promise.withResolvers<void>();
        const failure = new Error('unload failed');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);

        const unloadResult = unloadPlugin('blocked-instance');
        const loadResult = loadPlugin('p1', 'independent-instance');

        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'independent-instance');

        unloading.reject(failure);
        await expect(unloadResult).rejects.toBe(failure);
        await expect(loadResult).resolves.toBe(pluginInstance);
    });

    it('rejects queued same-instance work after failure and allows a later explicit retry', async () => {
        const unloading = Promise.withResolvers<void>();
        const failure = new Error('unload failed');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);

        const failedUnload = unloadPlugin('recovering-instance');
        const recoveredLoad = loadPlugin('p1', 'recovering-instance');

        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();
        unloading.reject(failure);
        await expect(failedUnload).rejects.toBe(failure);
        await expect(recoveredLoad).rejects.toBe(failure);
        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();

        const retriedLoad = loadPlugin('p1', 'recovering-instance');
        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1);
        await expect(retriedLoad).resolves.toBe(pluginInstance);
    });

    it('exposes only the ignored caller branch as an unhandled rejection', () => {
        const moduleUrl = pathToFileURL(
            resolve('src/modules/PluginHost/useCases/pluginLifecycle/serializePluginLifecycle.ts')
        ).href;
        const script = `
            import { serializePluginLifecycle } from ${JSON.stringify(moduleUrl)};

            const observed = [];
            process.on('unhandledRejection', (reason, promise) => {
                observed.push({ reason, promise });
            });

            const ignoredFailure = new Error('ignored caller failure');
            const ignoredResult = serializePluginLifecycle('ignored-instance', () =>
                Promise.reject(ignoredFailure)
            );
            await new Promise((resolve) => setImmediate(resolve));

            const caughtFailure = new Error('caught caller failure');
            const caughtResult = serializePluginLifecycle('caught-instance', () =>
                Promise.reject(caughtFailure)
            );
            await caughtResult.catch(() => undefined);
            await new Promise((resolve) => setImmediate(resolve));

            console.log(JSON.stringify({
                count: observed.length,
                ignoredCallerWasReported:
                    observed[0]?.reason === ignoredFailure && observed[0]?.promise === ignoredResult,
            }));
        `;

        const output = execFileSync(
            process.execPath,
            ['--experimental-strip-types', '--input-type=module', '--eval', script],
            {
                encoding: 'utf8',
            }
        );

        expect(JSON.parse(output)).toEqual({
            count: 1,
            ignoredCallerWasReported: true,
        });
    });

    it('openPluginGui delegates to repository', async () => {
        await openPluginGui('inst1');
        expect(mocks.openPluginGuiRepo).toHaveBeenCalledWith('inst1');
    });
});
