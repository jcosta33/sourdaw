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

    /**
     * The pan *lane* is normalised, the pan *track field* is not. Every other
     * authority on the lane agrees it runs -1..1: `addAutomationLane` gives a
     * pan lane `minValue: -1`, `applyAutomation` multiplies the stored value by
     * 50 on the way to `scheduleTrackPan`, and the lane editor formats it as
     * `value * 100` with an L/R suffix. Recording the raw -50..50 field into it
     * made a hard-left-to-hard-right sweep read back as ±2500, which
     * `TrackNode` clamps to ±1 — a hard-panned square wave with a step at the
     * zero crossing — and drew the curve 50x outside its own grid.
     */
    it('records pan into the lane in the lane’s own -1..1 units', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackPan('t1', -10);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'pan', -0.2, 10);
    });

    it('records a full-scale sweep inside the lane bounds and round-trips through playback', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 0 };

        setTrackPan('t1', -50);
        setTrackPan('t1', 50);

        const recorded = mocks.recordAutomationValue.mock.calls.map((call) => call[2] as number);
        expect(recorded).toEqual([-1, 1]);
        // `applyAutomation` scales by 50 on the way out, so the recorded value
        // has to survive the round trip back to the pan the user performed.
        expect(recorded.map((value) => value * 50)).toEqual([-50, 50]);
    });

    it('skips persistence but still records the gesture when the change is transient', () => {
        // Same split as `setTrackGain`: a live drag sample keeps out of project
        // truth, but the ride is the automation and still has to reach the
        // recorder — and the Toaster pad mirror is an engine write, so it rides
        // with the engine call rather than with persistence.
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackPan('t1', -10, true);

        expect(mocks.engineSetTrackPan).toHaveBeenCalledWith('t1', -10);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'pan', -0.2, 10);
    });

    it('records nothing from a transient change while the transport is stopped', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: false };

        setTrackPan('t1', -10, true);

        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
    });
});
