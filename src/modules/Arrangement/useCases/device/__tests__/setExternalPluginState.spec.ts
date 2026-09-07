import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { setExternalPluginState } from '../setExternalPluginState';

const mocks = vi.hoisted(() => ({
    getTrackState:
        vi.fn<() => { tracks: { id: string; devices: { id: string; externalInstanceId?: string }[] }[] } | null>(),
    mapAllTracks: vi.fn<(mapper: (track: Track) => Track) => void>(),
    clearExternalPluginRestoreFailure: vi.fn<(instanceId: string) => void>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));
vi.mock('#/modules/PluginHost/useCases', () => ({
    clearExternalPluginRestoreFailure: mocks.clearExternalPluginRestoreFailure,
}));

function deviceOnly(id: string, extra: Partial<Track['devices'][number]> = {}): Track['devices'][number] {
    return { id, name: id, type: 'external-plugin', bypassed: false, parameterValues: {}, ...extra };
}

describe('setExternalPluginState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stamps the chunk onto the matching device and reports a write', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] });

        const result = setExternalPluginState('d1', 'Y2h1bms=');

        expect(result).toBe(true);
        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);

        const mapper = mocks.mapAllTracks.mock.calls[0]![0];
        const mapped = mapper({ devices: [deviceOnly('d1'), deviceOnly('d2')] } as unknown as Track);
        expect(mapped.devices[0]!.externalStateChunk).toBe('Y2h1bms=');
        expect(mapped.devices[1]!.externalStateChunk).toBeUndefined();
    });

    // Issue 3693: a deliberate replacement re-establishes authoritative state,
    // so the failed-restore marker that makes capture preserve the stored chunk
    // must clear in the use case that owns the mutation.
    it('clears the failed-restore marker for the written device instance', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', externalInstanceId: 'inst-1' }] }],
        });

        expect(setExternalPluginState('d1', 'Y2h1bms=')).toBe(true);
        expect(mocks.clearExternalPluginRestoreFailure).toHaveBeenCalledExactlyOnceWith('inst-1');
    });

    it('does not clear a marker when the written device carries no instance', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] });

        expect(setExternalPluginState('d1', 'x')).toBe(true);
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it('reports no-write and does not mutate when the device is absent', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'other' }] }] });

        expect(setExternalPluginState('d1', 'x')).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it('reports no-write when there is no track state', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(setExternalPluginState('d1', 'x')).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });
});
