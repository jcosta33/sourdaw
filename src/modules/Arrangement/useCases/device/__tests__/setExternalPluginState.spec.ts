import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { setExternalPluginState } from '../setExternalPluginState';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<() => { tracks: { id: string; devices: { id: string }[] }[] } | null>(),
    mapAllTracks: vi.fn<(mapper: (track: Track) => Track) => void>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));

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

    it('reports no-write and does not mutate when the device is absent', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'other' }] }] });

        expect(setExternalPluginState('d1', 'x')).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('reports no-write when there is no track state', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(setExternalPluginState('d1', 'x')).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });
});
