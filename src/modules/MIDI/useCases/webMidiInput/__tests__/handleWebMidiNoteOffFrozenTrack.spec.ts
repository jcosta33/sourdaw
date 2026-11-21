import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

import type { RecordingMidiAdmission } from '#/modules/Arrangement/stores';

const get_track_strip = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));
const recording_admission = vi.hoisted(() => ({
    get: vi.fn<() => RecordingMidiAdmission | undefined>(() => undefined),
    retire: vi.fn<(id: string) => void>(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    isRecordingMidiInputExcluded: () => false,
    getRecordingMidiAdmission: recording_admission.get,
    retireRecordingMidiAdmission: recording_admission.retire,
    takeOwnsRecordingRoot: () => true,
}));

vi.mock('../recordingMidiAdmissionPort', () => ({
    recordingMidiAdmissionPort: {
        isRecordingMidiInputExcluded: () => false,
        getRecordingMidiAdmission: recording_admission.get,
        retireRecordingMidiAdmission: recording_admission.retire,
        takeOwnsRecordingRoot: () => true,
    },
}));

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => false,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        isBypassedNoteReceiver: actual.isBypassedNoteReceiver,
        resolveDrumKitBy: actual.resolveDrumKitBy,
        resolveDrumKitOutputGain: actual.resolveDrumKitOutputGain,
        resolveLiveNoteControls: actual.resolveLiveNoteControls,
        resolveNoteReceivingInstrument: actual.resolveNoteReceivingInstrument,
        builtinSynthVoice: { read: vi.fn() },
        audioEngine: {
            context: audio_clock,
            getTrackStrip: get_track_strip,
        },
        getCompensationDelay: () => 0,
        getFactoryDrumKitByIndex: () => null,
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiControl: async () => true,
        sendNativeLiveMidiNote: async () => true,
        soundsNativeNotes: () => false,
    };
});

const { handleWebMidiNoteOff } = await import('../handleWebMidiNoteOff');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

type HandleWebMidiNoteOffDependencies = Parameters<typeof handleWebMidiNoteOff._factory>[0];
type AppendRecordedMidiNote = (input: { clipId: string; note: { id: string } }) => void;

function make_dependencies(
    frozen: boolean,
    appendRecordedMidiNote: AppendRecordedMidiNote
): HandleWebMidiNoteOffDependencies {
    return {
        getCompensationDelay: () => 0,
        getTrackStoreState: () => ({
            tracks: [
                {
                    id: 'track-1',
                    armed: true,
                    frozen,
                    devices: [],
                    clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 4 }],
                },
            ],
            selectedTrackId: 'track-1',
        }),
        getTransportStoreValue: () => ({ isRecording: true, overdubEnabled: true, isLooping: false, tempo: 120 }),
        playheadPositionRef: { current: 2 },
        createMidiNote: () => ({ id: 'note-1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }),
        appendRecordedMidiNote,
        getSynthParamsForTrack: () => ({ release: 0.3 }),
        processRealtimeMidiInput: async () => [],
        stepRecordNoteOff: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiNote: async () => true,
        soundsNativeNotes: () => false,
    };
}

function holdNote(): void {
    activeNotes.set(createWebMidiNoteKey(0, 60), {
        channel: 0,
        note: 60,
        velocity: 100,
        trackId: 'track-1',
        instrumentTrackId: 'track-1',
        startTime: 1,
        startBeat: 1,
    });
}

function holdAdmittedNote(recordingAdmissionId: string): void {
    activeNotes.set(createWebMidiNoteKey(0, 60), {
        channel: 0,
        note: 60,
        velocity: 100,
        trackId: 'track-1',
        instrumentTrackId: 'track-1',
        startTime: 1,
        startBeat: 1,
        recordingAdmissionId,
    });
}

const admission: RecordingMidiAdmission = {
    id: 'admission-1',
    clipId: 'clip-1',
    trackId: 'track-1',
    channel: 0,
    note: 60,
    velocity: 100,
    onsetAudioTime: 1,
    onsetSourceBeat: 1,
    releaseAudioTime: 2,
    releaseSourceBeat: 2,
    initialExpression: {},
    expressionChanges: [],
};

describe('handleWebMidiNoteOff on an armed track that is frozen (issue #7239)', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        get_track_strip.mockReset();
        recording_admission.get.mockReset().mockReturnValue(undefined);
        recording_admission.retire.mockReset();
    });

    it('appends the played note to the clip while the armed track is not frozen', async () => {
        const append = vi.fn<AppendRecordedMidiNote>();
        holdNote();

        await handleWebMidiNoteOff._factory(make_dependencies(false, append))(0, 60, 0);

        expect(append).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-1' }));
    });

    it('appends nothing for a note played on the armed frozen track', async () => {
        const append = vi.fn<AppendRecordedMidiNote>();
        holdNote();

        await handleWebMidiNoteOff._factory(make_dependencies(true, append))(0, 60, 0);

        expect(append).not.toHaveBeenCalled();
    });

    it('appends nothing for an admitted take note when the track froze after the note-on', async () => {
        const append = vi.fn<AppendRecordedMidiNote>();
        recording_admission.get.mockReturnValue(admission);
        holdAdmittedNote(admission.id);

        await handleWebMidiNoteOff._factory(make_dependencies(true, append))(0, 60, 0);

        expect(append).not.toHaveBeenCalled();
    });
});
