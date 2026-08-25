import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
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

    it('no longer clamps 1.5 down to unity — the fader has +6 dB of real headroom', () => {
        setTrackGain('t1', 1.5);
        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 1.5);
    });

    it('clamps gain to the +6 dB ceiling, and floors negative gain at 0', () => {
        setTrackGain('t1', 2.5);
        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', FADER_MAX_GAIN);

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
        // from its recording. A live drag sample must not write the store —
        // project truth belongs to the committed value — but the ride itself is
        // the automation, so it still reaches `recordAutomationValue`, which
        // buffers it for the RDP thinning `flushPendingPoints` runs on release.
        // Recording only the committed endpoint replaced a whole fader ride
        // with a step at the release beat.
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 10 };

        setTrackGain('t1', 0.8, true);

        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 0.8);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'gain', 0.8, 10);
    });

    /**
     * The fader and the pad are two gain stages in series —
     * `createWebAudioEngine` connects the pad output into the child track's
     * `gainNode` — so mirroring the strip gain onto the pad's `volume` applied
     * every move twice: a pad-mirrored track at fader 0.8 played at 0.64
     * (#2458). The pad keeps its own level (kit state, owned by the Toaster
     * panel); the fader drives only the strip. This holds for the transient
     * half of a drag too: an engine write that skips persistence must still
     * not touch the pad.
     */
    it('never writes the Toaster pad volume from the fader, even mid-drag', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'toaster-bus',
                    kind: 'bus',
                    devices: [
                        {
                            id: 'toaster-device',
                            name: 'Toaster',
                            type: 'toaster',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
                TrackDummy.create({ id: 't1', kind: 'audio', parentId: 'toaster-bus' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.getAllTracks.mockReturnValue(trackStore.value!.tracks);

        setTrackGain('t1', 0.4, true);

        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 0.4);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        // Still no persistence — nothing crosses the guard on a transient.
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    /**
     * With the mirror gone there is no second gain node to diverge from, so a
     * pad-mirrored track's fader reaches `FADER_MAX_GAIN` like every other
     * strip — and the writer stores what the strip asked for, which is what
     * keeps the undo entry's `expectedGain` honest.
     */
    it('gives a Toaster pad track the same fader travel and stored value as any other strip', () => {
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'toaster-bus',
                    kind: 'bus',
                    devices: [
                        {
                            id: 'toaster-device',
                            name: 'Toaster',
                            type: 'toaster',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
                TrackDummy.create({ id: 't1', kind: 'audio', parentId: 'toaster-bus' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.getAllTracks.mockReturnValue(trackStore.value!.tracks);

        setTrackGain('t1', 1.5);

        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', 1.5);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        const updater = mocks.updateTrack.mock.calls[0]![1] as (t: { gain: number }) => { gain: number };
        expect(updater({ gain: 0.8 })).toEqual({ gain: 1.5 });
    });

    it('records nothing from a transient change while the transport is stopped', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: false };

        setTrackGain('t1', 0.8, true);

        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
    });
});
