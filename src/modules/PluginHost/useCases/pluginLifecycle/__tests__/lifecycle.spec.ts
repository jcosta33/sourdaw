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

    it('allows different instances to progress independently', async () => {
        const unloading = Promise.withResolvers<void>();
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);

        const unloadResult = unloadPlugin('blocked-instance');
        const loadResult = loadPlugin('p1', 'independent-instance');

        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'independent-instance');

        unloading.resolve();
        await Promise.all([unloadResult, loadResult]);
    });

    it('continues after failure and removes the settled queue entry', async () => {
        const unloading = Promise.withResolvers<void>();
        const failure = new Error('unload failed');
        mocks.unloadPluginRepo.mockReturnValueOnce(unloading.promise);
        mocks.loadPluginRepo.mockResolvedValueOnce(pluginInstance);

        const failedUnload = unloadPlugin('recovering-instance');
        const recoveredLoad = loadPlugin('p1', 'recovering-instance');

        expect(mocks.loadPluginRepo).not.toHaveBeenCalled();
        unloading.reject(failure);
        await expect(failedUnload).rejects.toBe(failure);
        await expect(recoveredLoad).resolves.toBe(pluginInstance);

        mocks.unloadPluginRepo.mockResolvedValueOnce(undefined);
        const postCleanupUnload = unloadPlugin('recovering-instance');
        expect(mocks.unloadPluginRepo).toHaveBeenCalledTimes(2);
        await postCleanupUnload;
    });

    it('openPluginGui delegates to repository', async () => {
        await openPluginGui('inst1');
        expect(mocks.openPluginGuiRepo).toHaveBeenCalledWith('inst1');
    });
});
