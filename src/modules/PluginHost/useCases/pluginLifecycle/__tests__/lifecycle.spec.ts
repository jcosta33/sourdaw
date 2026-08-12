import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadedExternalInstances } from '../loadedExternalInstances';
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
        loadedExternalInstances.clear();
        mocks.loadPluginRepo.mockResolvedValue(pluginInstance);
        mocks.unloadPluginRepo.mockResolvedValue(undefined);
    });

    it('loadPlugin delegates to repository', async () => {
        await loadPlugin('p1', 'inst1');
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'inst1');
    });

    it('unloadPlugin delegates to repository', async () => {
        loadedExternalInstances.add('inst1');
        await unloadPlugin('inst1');
        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith('inst1');
    });

    it('coalesces unloads while ownership remains published until native success', async () => {
        const unloading = Promise.withResolvers<void>();
        loadedExternalInstances.add('inst1');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        const first = unloadPlugin('inst1');
        const second = unloadPlugin('inst1');
        await Promise.resolve();
        expect(loadedExternalInstances.has('inst1')).toBe(true);
        unloading.resolve();
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
        expect(mocks.unloadPluginRepo).toHaveBeenCalledTimes(1);
        expect(loadedExternalInstances.has('inst1')).toBe(false);
    });

    it('retains runtime ownership when native unload fails', async () => {
        const failure = new Error('native unload failed');
        mocks.unloadPluginRepo.mockRejectedValueOnce(failure);
        loadedExternalInstances.add('owned-instance');
        await expect(unloadPlugin('owned-instance')).rejects.toBe(failure);
        expect(loadedExternalInstances.has('owned-instance')).toBe(true);
    });

    it('delegates unload-all to native after renderer ownership is lost', async () => {
        await unloadPlugin();
        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith();
    });
    it('serializes unload then load for the same instance', async () => {
        const unloading = Promise.withResolvers<void>();
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);
        loadedExternalInstances.add('ordered-instance');

        const unloadResult = unloadPlugin('ordered-instance');
        const loadResult = loadPlugin('p1', 'ordered-instance');
        await Promise.resolve();

        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith('ordered-instance');
        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();

        unloading.resolve();
        await Promise.all([unloadResult, loadResult]);

        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'ordered-instance');
        expect(mocks.unloadPluginRepo.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadPluginRepo.mock.invocationCallOrder[0]!
        );
    });

    it('registers an idle tail before a same-instance operation can reenter', async () => {
        const order: string[] = [];
        let nestedResult: ReturnType<typeof loadPlugin> | undefined;
        mocks.unloadPluginRepo.mockImplementationOnce(() => {
            order.push('outer-start');
            nestedResult = loadPlugin('p1', 'reentrant-instance');
            order.push('outer-return');
            return Promise.resolve();
        });
        mocks.loadPluginRepo.mockImplementationOnce(() => {
            order.push('nested-run');
            return Promise.resolve(pluginInstance);
        });
        loadedExternalInstances.add('reentrant-instance');

        const outerResult = unloadPlugin('reentrant-instance');
        await Promise.resolve();

        expect(order).toEqual(['outer-start', 'outer-return']);
        await expect(outerResult).resolves.toBeUndefined();
        if (!nestedResult) {
            throw new Error('Expected the outer operation to enqueue a nested load');
        }
        await expect(nestedResult).resolves.toBe(pluginInstance);
        expect(order).toEqual(['outer-start', 'outer-return', 'nested-run']);
    });

    it('allows a different instance to progress while an unload is pending and then fails', async () => {
        const unloading = Promise.withResolvers<void>();
        const failure = new Error('unload failed');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);
        loadedExternalInstances.add('blocked-instance');

        const unloadResult = unloadPlugin('blocked-instance');
        const loadResult = loadPlugin('p1', 'independent-instance');
        await Promise.resolve();

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
        loadedExternalInstances.add('recovering-instance');

        const failedUnload = unloadPlugin('recovering-instance');
        const recoveredLoad = loadPlugin('p1', 'recovering-instance');

        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();
        unloading.reject(failure);
        await expect(failedUnload).rejects.toBe(failure);
        await expect(recoveredLoad).rejects.toBe(failure);
        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();

        const retriedLoad = loadPlugin('p1', 'recovering-instance');
        await Promise.resolve();
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
