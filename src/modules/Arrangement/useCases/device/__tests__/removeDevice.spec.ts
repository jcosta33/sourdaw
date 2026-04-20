import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeDevice } from '../removeDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    mapAllTracks: vi.fn(),
    removeDeviceFromStrip: vi.fn(),
    unloadPlugin: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    removeDeviceFromStrip: mocks.removeDeviceFromStrip,
}));

vi.mock('#/modules/Plugin/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    unloadPlugin: mocks.unloadPlugin,
}));

describe('removeDevice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes device from store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'reverb' }] }],
        });

        removeDevice('d1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'd1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const updater = mocks.mapAllTracks.mock.calls[0][0];
        expect(updater({ devices: [{ id: 'd1' }, { id: 'd2' }] })).toEqual({ devices: [{ id: 'd2' }] });
    });

    it('unloads plugin if it is an external plugin', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'external-plugin', externalInstanceId: 'inst1' }] }],
        });

        removeDevice('d1');

        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
    });
});
