import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackGain } from '../setTrackGain';

const mocks = vi.hoisted(() => {
    const transportStoreValue: unknown = { isPlaying: false };
    return {
        updateTrack: vi.fn(),
        engineSetTrackGain: vi.fn(),
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
    setTrackGain: mocks.engineSetTrackGain,
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

describe('setTrackGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.transportStoreValue = { isPlaying: false };
    });

    it('updates track gain and notifies engine', () => {
        setTrackGain('t1', 0.5);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0]![1] as (t: { gain: number }) => { gain: number };
        expect(updater({ gain: 1.0 })).toEqual({ gain: 0.5 });

        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 0.5);
    });

    it('clamps gain between 0 and 1', () => {
        setTrackGain('t1', 1.5);
        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 1);

        setTrackGain('t1', -0.5);
        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 0);
    });

    it('records automation if track automation mode is write/touch', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackGain('t1', 0.8);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'gain', 0.8, 10);
    });

    it('skips persistence but still records the gesture when the change is transient', () => {
        // `isTransient` splits persistence from the gesture, not the gesture
        // from its recording. A live drag sample must not write the store or
        // the Toaster pad mirror — project truth belongs to the committed
        // value — but the ride itself is the automation, so it still reaches
        // `recordAutomationValue`, which buffers it for the RDP thinning
        // `flushPendingPoints` runs on release. Recording only the committed
        // endpoint replaced a whole fader ride with a step at the release beat.
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackGain('t1', 0.8, true);

        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 0.8);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'gain', 0.8, 10);
    });

    it('records nothing from a transient change while the transport is stopped', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: false };

        setTrackGain('t1', 0.8, true);

        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
    });
});
