import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackPan } from '../setTrackPan';

const mocks = vi.hoisted(() => {
    const transportStoreValue: unknown = { isPlaying: false };
    return {
        updateTrack: vi.fn(),
        engineSetTrackPan: vi.fn(),
        updateDeviceParam: vi.fn(),
        getAllTracks: vi.fn(),
        transportStoreValue,
        getTrackById: vi.fn(),
        recordAutomationValue: vi.fn(),
    };
});

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackPan: mocks.engineSetTrackPan,
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/useCases/getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return mocks.transportStoreValue;
        },
    },
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    recordAutomationValue: mocks.recordAutomationValue,
}));

describe('setTrackPan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.transportStoreValue = { isPlaying: false };
    });

    it('updates track pan and notifies engine', () => {
        setTrackPan('t1', 25);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0]![1] as (t: { pan: number }) => { pan: number };
        expect(updater({ pan: 0 })).toEqual({ pan: 25 });

        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', 25);
    });

    it('clamps pan between -50 and 50', () => {
        setTrackPan('t1', 60);
        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', 50);

        setTrackPan('t1', -100);
        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', -50);
    });

    it('records automation if track automation mode is write/touch', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackPan('t1', -10);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'pan', -10, 10);
    });

    it('skips persistence but still records the gesture when the change is transient', () => {
        // Same split as `setTrackGain`: a live drag sample keeps out of project
        // truth and out of the Toaster pad mirror, but the ride is the
        // automation and still has to reach the recorder.
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackPan('t1', -10, true);

        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', -10);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'pan', -10, 10);
    });

    it('records nothing from a transient change while the transport is stopped', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: false };

        setTrackPan('t1', -10, true);

        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
    });
});
