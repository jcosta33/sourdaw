import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { TOASTER_PAD_MAX_GAIN } from '../isToasterPadTrack';
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
     * The Toaster pad mirror is an engine write, not a persistence write.
     * `updateDeviceParam` is "the single door every device-parameter write
     * reaches the DSP through" (its own docblock; `persistDeviceParam` is the
     * store-side twin), and the pad gain sits in series with the track's strip
     * gain on the same audio — `createWebAudioEngine` connects the pad output
     * into the child track's `gainNode`. Leaving the mirror behind the
     * persistence guard meant a drag on a Toaster pad track ran at
     * `padGain × oldTrackGain` while the thumb was down and
     * `padGain × newTrackGain` the instant it lifted: an audible step on
     * release, ~6 dB for a 0.8 → 0.4 move.
     */
    it('mirrors a transient change onto the Toaster pad in the same breath as the engine write', () => {
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

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('toaster-bus', 'toaster-device', 'pad_0_volume', 0.4);
        // Still no persistence — only the engine side crossed the guard.
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    /**
     * The mirror writes one value to two nodes in series, and the pad's own
     * range stops at unity (`pad.rs`: `"volume" => value.clamp(0.0, 1.0)`).
     * Above unity the strip and the pad would take different values — the
     * divergence the mirror exists to prevent — so a pad-mirrored track's
     * fader is held at the narrower range, and both writes stay identical.
     */
    it('holds a Toaster pad track at the pad ceiling so the mirror cannot diverge from the strip', () => {
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

        expect(mocks.engineSetTrackGain).toHaveBeenCalledWith('t1', TOASTER_PAD_MAX_GAIN);
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith(
            'toaster-bus',
            'toaster-device',
            'pad_0_volume',
            TOASTER_PAD_MAX_GAIN
        );
        const updater = mocks.updateTrack.mock.calls[0]![1] as (t: { gain: number }) => { gain: number };
        expect(updater({ gain: 0.8 })).toEqual({ gain: TOASTER_PAD_MAX_GAIN });
    });

    it('records nothing from a transient change while the transport is stopped', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', automationMode: 'write' });
        mocks.transportStoreValue = { isPlaying: false };

        setTrackGain('t1', 0.8, true);

        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
    });
});
