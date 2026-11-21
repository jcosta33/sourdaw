import { beforeEach, describe, expect, it, vi } from 'vitest';

import { unloadDiscardedHostedPlugins } from '../unloadDiscardedHostedPlugins';

import type { unloadPlugin, unloadPluginCarryingLiveState } from '#/modules/PluginHost/useCases';

const mocks = vi.hoisted(() => ({
    clearReportedLatency: vi.fn<(deviceId: string) => void>(),
    unloadPlugin: vi.fn<typeof unloadPlugin>(),
    unloadPluginCarryingLiveState: vi.fn<typeof unloadPluginCarryingLiveState>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearReportedLatency: mocks.clearReportedLatency,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: mocks.unloadPlugin,
    unloadPluginCarryingLiveState: mocks.unloadPluginCarryingLiveState,
}));

const INSTANCES = [
    { deviceId: 'd-1', instanceId: 'p-1' },
    { deviceId: 'd-2', instanceId: 'q-2' },
];

describe('unloadDiscardedHostedPlugins', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.unloadPlugin.mockResolvedValue(undefined);
        mocks.unloadPluginCarryingLiveState.mockResolvedValue(undefined);
    });

    it('carries each discarded instance live state to the redo that reactivates it', async () => {
        await unloadDiscardedHostedPlugins(INSTANCES);

        expect(mocks.unloadPluginCarryingLiveState.mock.calls).toEqual([['p-1'], ['q-2']]);
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
        expect(mocks.clearReportedLatency.mock.calls).toEqual([['d-1'], ['d-2']]);
    });

    // An Undo landing mid-teardown waits only on unloads already requested, so none may wait on another.
    it('requests every unload before the first one settles', async () => {
        const firstUnload = Promise.withResolvers<void>();
        mocks.unloadPluginCarryingLiveState.mockReturnValueOnce(firstUnload.promise);

        const release = unloadDiscardedHostedPlugins(INSTANCES);

        expect(mocks.unloadPluginCarryingLiveState.mock.calls).toEqual([['p-1'], ['q-2']]);
        firstUnload.resolve();
        await release;
    });

    it('still unloads the other instances and reports every failure when one teardown fails', async () => {
        mocks.unloadPluginCarryingLiveState.mockRejectedValueOnce(new Error('host gone'));

        await expect(unloadDiscardedHostedPlugins(INSTANCES)).rejects.toThrow(
            'Plugin host teardown failed for instance p-1: host gone'
        );
        expect(mocks.unloadPluginCarryingLiveState.mock.calls).toEqual([['p-1'], ['q-2']]);
        expect(mocks.clearReportedLatency.mock.calls).toEqual([['d-1'], ['d-2']]);
    });
});
