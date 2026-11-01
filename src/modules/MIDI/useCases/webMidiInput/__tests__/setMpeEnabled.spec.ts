import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tempoMapStore } from '#/modules/Transport/stores';

import { channelPitchBendState } from '../../../repositories/webMidi/channelPitchBendState';
import { getMpeEnabled } from '../../../repositories/webMidi/getMpeEnabled';
import { recordedControllerTakeState } from '../../../repositories/webMidi/recordedControllerTakeState';
import { setMpeEnabledInternal } from '../../../repositories/webMidi/setMpeEnabledInternal';
import { bufferRecordedMidiCC } from '../../recordedControllerTake/bufferRecordedMidiCC';
import { bufferRecordedMidiPitchBend } from '../../recordedControllerTake/bufferRecordedMidiPitchBend';

const target_track_id = vi.hoisted(() => ({ value: 'track-1' as string | null }));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => target_track_id.value,
}));

vi.mock('../recordingMidiAdmissionPort', () => ({
    recordingMidiAdmissionPort: { takeOwnsRecordingRoot: () => true },
}));

// The switch happens at the transport's beat 6, two beats into the recording clip.
vi.mock('../captureEventBeat', () => ({
    captureEventPositionAt: () => ({ beat: 6, passIndex: 0 }),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { context: { currentTime: 2, sampleRate: 48_000, baseLatency: 0, outputLatency: 0 } },
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: vi.fn(() => false),
}));

const { setMpeEnabled } = await import('../setMpeEnabled');

const RECORDING_CLIP_ID = 'clip-rec';

type SetMpeEnabledDependencies = Parameters<typeof setMpeEnabled._factory>[0];

function dependencies(isRecording = true): SetMpeEnabledDependencies {
    return {
        getTrackStoreState: () => ({
            tracks: [
                {
                    id: 'track-1',
                    armed: true,
                    devices: [],
                    clips: [{ id: RECORDING_CLIP_ID, type: 'midi', startBeat: 4, endBeat: 12, midiOffsetBeats: 0 }],
                },
            ],
            selectedTrackId: 'track-1',
        }),
        getTransportStoreValue: () => ({ isRecording, overdubEnabled: false, isLooping: false, tempo: 120 }),
        getCompensationDelay: () => 0,
        bufferRecordedMidiCC,
        bufferRecordedMidiPitchBend,
    } as SetMpeEnabledDependencies;
}

function recordedRows() {
    return (recordedControllerTakeState.buffers.get(RECORDING_CLIP_ID)?.pitchBend ?? []).map(
        ({ id: _id, ...row }) => row
    );
}

describe('setMpeEnabled', () => {
    beforeEach(() => {
        setMpeEnabledInternal(false);
        channelPitchBendState.clear();
        recordedControllerTakeState.buffers.clear();
        tempoMapStore.set({ changes: [] });
        target_track_id.value = 'track-1';
    });

    it('switches MPE input handling on and off', () => {
        const fn = setMpeEnabled._factory(dependencies(false));

        fn(true);
        expect(getMpeEnabled()).toBe(true);

        fn(false);
        expect(getMpeEnabled()).toBe(false);
    });

    describe('during a take', () => {
        it('records the master wheel unscoped where MPE is switched on, so member notes struck after it replay bent', () => {
            // With MPE off the channel-0 wheel was recorded scoped to channel 0. Live, a member note struck after
            // the switch starts under the zone master's wheel, so the take says so at the switch.
            channelPitchBendState.set(0, 4096);
            const fn = setMpeEnabled._factory(dependencies());

            fn(true);

            expect(recordedRows()).toEqual([{ value: 4096, beat: 2, channel: 0 }]);
        });

        it('records a centred master where MPE is switched on over another channel’s off-centre wheel', () => {
            // A member note on channel 3 starts under the centred master live, not under channel 3's old wheel.
            channelPitchBendState.set(3, -2048);
            const fn = setMpeEnabled._factory(dependencies());

            fn(true);

            expect(recordedRows()).toEqual([{ value: 0, beat: 2, channel: 0 }]);
        });

        it('records nothing where MPE is switched on with every wheel centred', () => {
            const fn = setMpeEnabled._factory(dependencies());

            fn(true);

            expect(recordedRows()).toEqual([]);
        });

        it('records nothing when MPE was already on', () => {
            setMpeEnabledInternal(true);
            channelPitchBendState.set(0, 4096);
            const fn = setMpeEnabled._factory(dependencies());

            fn(true);

            expect(recordedRows()).toEqual([]);
        });

        it('returns every channel to its own wheel where MPE is switched off', () => {
            // With MPE on the master's bend was recorded unscoped and reaches every note. Live, after the switch a
            // note starts under its own channel's wheel, so the master's reach ends and each wheel is scoped again.
            setMpeEnabledInternal(true);
            channelPitchBendState.set(0, 4096);
            channelPitchBendState.set(2, -1024);
            const fn = setMpeEnabled._factory(dependencies());

            fn(false);

            expect(recordedRows()).toEqual([
                { value: 0, beat: 2, channel: 0 },
                { value: 4096, beat: 2, channel: 0, channelScoped: true },
                { value: -1024, beat: 2, channel: 2, channelScoped: true },
            ]);
        });

        it('records nothing at a switch while the transport is not recording', () => {
            channelPitchBendState.set(0, 4096);
            const fn = setMpeEnabled._factory(dependencies(false));

            fn(true);

            expect(recordedControllerTakeState.buffers.size).toBe(0);
        });
    });
});
