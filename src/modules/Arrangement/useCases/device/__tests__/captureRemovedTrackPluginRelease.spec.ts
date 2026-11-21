import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureRemovedTrackPluginRelease } from '../captureRemovedTrackPluginRelease';

import type { unloadPluginCarryingLiveState } from '#/modules/PluginHost/useCases';

const mocks = vi.hoisted(() => ({
    clearReportedLatency: vi.fn<(deviceId: string) => void>(),
    unloadPluginCarryingLiveState: vi.fn<typeof unloadPluginCarryingLiveState>(),
    getTrackStoreState: vi.fn(),
    runtime: { current: true, committedTrackIds: new Set<string>() },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearReportedLatency: mocks.clearReportedLatency,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: vi.fn(),
    unloadPluginCarryingLiveState: mocks.unloadPluginCarryingLiveState,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../captureTrackRemovalRuntimeAuthority', () => ({
    captureTrackRemovalRuntimeAuthority: () => ({
        isCurrent: () => mocks.runtime.current,
        guard:
            <Result>(effect: () => Result) =>
            () =>
                mocks.runtime.current ? effect() : undefined,
        guardAbsent:
            <Result>(trackId: string, effect: () => Result) =>
            () =>
                mocks.runtime.current && !mocks.runtime.committedTrackIds.has(trackId) ? effect() : undefined,
    }),
}));

function hostedTrack(trackId: string, instanceIds: string[]) {
    return {
        id: trackId,
        devices: [
            { id: `${trackId}-eq`, type: 'eq' },
            ...instanceIds.map((instanceId) => ({
                id: `${trackId}-${instanceId}`,
                type: 'external-plugin',
                externalInstanceId: instanceId,
            })),
        ],
    };
}

describe('captureRemovedTrackPluginRelease', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.runtime.current = true;
        mocks.runtime.committedTrackIds = new Set();
        mocks.unloadPluginCarryingLiveState.mockResolvedValue(undefined);
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [hostedTrack('t-a', ['p-1', 'p-2']), hostedTrack('t-b', ['q-1']), hostedTrack('t-c', [])],
        });
    });

    it('releases the hosted instances the tracks held when captured, after they left the store', async () => {
        const release = captureRemovedTrackPluginRelease(['t-a', 't-c']);
        mocks.getTrackStoreState.mockReturnValue({ tracks: [hostedTrack('t-b', ['q-1'])] });

        expect(mocks.unloadPluginCarryingLiveState).not.toHaveBeenCalled();
        await release();

        expect(mocks.unloadPluginCarryingLiveState.mock.calls).toEqual([['p-1'], ['p-2']]);
        expect(mocks.clearReportedLatency.mock.calls).toEqual([['t-a-p-1'], ['t-a-p-2']]);
    });

    it('keeps the instances of a track committed truth still holds', async () => {
        const release = captureRemovedTrackPluginRelease(['t-a', 't-b']);
        mocks.runtime.committedTrackIds = new Set(['t-a']);

        await release();

        expect(mocks.unloadPluginCarryingLiveState.mock.calls).toEqual([['q-1']]);
    });

    it('releases nothing once the captured project root is gone', async () => {
        const release = captureRemovedTrackPluginRelease(['t-a', 't-b']);
        mocks.runtime.current = false;

        await release();

        expect(mocks.unloadPluginCarryingLiveState).not.toHaveBeenCalled();
    });

    it('ignores a track id the store does not hold', async () => {
        await captureRemovedTrackPluginRelease(['t-missing'])();

        expect(mocks.unloadPluginCarryingLiveState).not.toHaveBeenCalled();
    });
});
