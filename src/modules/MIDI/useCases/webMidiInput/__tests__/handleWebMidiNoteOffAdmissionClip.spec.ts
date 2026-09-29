import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const get_track_strip = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
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
}));

const { handleWebMidiNoteOff } = await import('../handleWebMidiNoteOff');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

type HandleWebMidiNoteOffDependencies = Parameters<typeof handleWebMidiNoteOff._factory>[0];

function make_dependencies(
    overrides: Partial<HandleWebMidiNoteOffDependencies> = {}
): HandleWebMidiNoteOffDependencies {
    return {
        getCompensationDelay: () => 0,
        getTrackStoreState: () => ({
            tracks: [
                {
                    id: 'track-1',
                    armed: true,
                    devices: [],
                    clips: [
                        { id: 'clip-early', type: 'midi', startBeat: 0, endBeat: 4 },
                        { id: 'clip-late', type: 'midi', startBeat: 4, endBeat: 8 },
                    ],
                },
            ],
            selectedTrackId: 'track-1',
        }),
        getTransportStoreValue: () => ({
            isRecording: true,
            overdubEnabled: true,
            isLooping: false,
            tempo: 120,
        }),
        playheadPositionRef: { current: 0 },
        createMidiNote: () => ({
            id: 'note-1',
            pitch: 60,
            startBeat: 0,
            duration: 2,
            velocity: 100,
        }),
        appendRecordedMidiNote: () => {},
        getSynthParamsForTrack: () => ({ release: 0.3 }),
        processRealtimeMidiInput: async () => [],
        stepRecordNoteOff: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiNote: async () => true,
        soundsNativeNotes: () => false,
        ...overrides,
    };
}

function admitNote(startBeat: number): void {
    activeNotes.set(createWebMidiNoteKey(0, 60), {
        channel: 0,
        note: 60,
        velocity: 100,
        trackId: 'track-1',
        instrumentTrackId: 'track-1',
        startTime: 1,
        startBeat, // timeline-absolute playhead beat at note-on
    });
}

// #4869 — a delayed release must not move a recorded note: the destination
// clip and its media origin resolve from the note's admitted musical onset
// (`startBeat`), never from the playhead at the time the note-off is
// processed.
describe('handleWebMidiNoteOff recorded-note destination clip', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        get_track_strip.mockReset();
        mpe_enabled.value = false;
        audio_clock.currentTime = 2;
        audio_clock.baseLatency = 0;
        audio_clock.outputLatency = 0;
    });

    it('commits a note to the clip holding its admitted onset, not the clip containing the playhead at release', async () => {
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 2, duration: 2, velocity: 100 }));
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                // The delayed note-off is processed after the playhead has
                // crossed the seam into clip-late.
                playheadPositionRef: { current: 6 },
            })
        );
        admitNote(2);

        await fn(0, 60, 0);

        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-early' }));
        // Clip-relative beat 2 against clip-early's media origin (0); the
        // clip-late origin (4) would clamp the note to 0 in the wrong clip.
        expect(create_midi_note).toHaveBeenCalledWith(60, 2, expect.any(Number), 100);
    });

    it('keeps a note admitted before a loop wrap in the clip it was admitted in', async () => {
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 3.5, duration: 2, velocity: 100 }));
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                getTransportStoreValue: () => ({
                    isRecording: true,
                    overdubEnabled: true,
                    isLooping: true,
                    loopStart: 0,
                    loopEnd: 8,
                    tempo: 120,
                }),
                // The playhead has already wrapped to the loop start by the
                // time the delayed note-off is processed.
                playheadPositionRef: { current: 0.5 },
            })
        );
        admitNote(7.5);

        await fn(0, 60, 0);

        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-late' }));
        // Clip-relative beat 3.5 against clip-late's media origin (4).
        expect(create_midi_note).toHaveBeenCalledWith(60, 3.5, expect.any(Number), 100);
    });
});
