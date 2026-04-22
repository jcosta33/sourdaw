import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { getTrackState } from '../../../repositories/track/getTrackState';
import type { mapAllTracks } from '../../../repositories/track/mapAllTracks';
import type { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';
import type { unloadPlugin } from '#/modules/Plugin/useCases';
import type { Track } from '../../../models/Track';
import type { Device } from '../../../models/Device';

import { removeDevice } from '../removeDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof getTrackState>(),
    mapAllTracks: vi.fn<typeof mapAllTracks>(),
    removeDeviceFromStrip: vi.fn<typeof removeDeviceFromStrip>(),
    unloadPlugin: vi.fn<typeof unloadPlugin>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    removeDeviceFromStrip: mocks.removeDeviceFromStrip,
}));

vi.mock('#/modules/Plugin/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Plugin/useCases')>()),
    unloadPlugin: mocks.unloadPlugin,
}));

describe('removeDevice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes device from store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'reverb' }] } as unknown as Track],
            selectedTrackId: null,
        });

        removeDevice('d1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'd1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const updater = mocks.mapAllTracks.mock.calls[0]![0] as (track: Partial<Track>) => Partial<Track>;
        expect(updater({ devices: [{ id: 'd1' }, { id: 'd2' }] as unknown as Device[] })).toEqual({ devices: [{ id: 'd2' }] });
    });

    it('unloads plugin if it is an external plugin', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'external-plugin', externalInstanceId: 'inst1' }] } as unknown as Track],
            selectedTrackId: null,
        });

        removeDevice('d1');

        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
    });
});
