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

    // #4668 — selection and storage must share one coordinate: storage
    // subtracts the input latency from the onset, so selection has to resolve
    // the clip on the same compensated beat, or a note heard at 3.92 whose
    // raw playhead read 4.02 is filed into the [4, 8) clip and clamped to its
    // seam instead of landing in [0, 4).
    it('selects the destination clip on the latency-compensated onset storage records', async () => {
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 3.92, duration: 2, velocity: 100 }));
        // 0.05 s at 120 BPM rewinds the heard onset 4.02 to beat 3.92.
        audio_clock.baseLatency = 0.05;
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                // The raw playhead beat at note-on sits past the seam; the
                // musician's compensated onset does not.
                playheadPositionRef: { current: 4.02 },
            })
        );
        admitNote(4.02);

        await fn(0, 60, 0);

        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-early' }));
        // Clip-relative beat 3.92 against clip-early's media origin (0); the
        // clip-late origin (4) would clamp the note to 0 in the wrong clip.
        expect(create_midi_note).toHaveBeenCalledWith(60, expect.closeTo(3.92, 6), expect.any(Number), 100);
    });

    // #4869 — a compensated onset that lands before every clip still belongs
    // to the clip it played against. The old last-clip fallback filed a
    // seam-rewound onset into the track's LAST clip: 0.05 s of latency at
    // 120 BPM rewinds a 0.02 strike to −0.08, and the note recorded four
    // beats late in clip-late.
    it('files an onset that lands before every clip into the first clip, the nearest in time', async () => {
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 0, duration: 2, velocity: 100 }));
        audio_clock.baseLatency = 0.05;
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                playheadPositionRef: { current: 0.02 },
            })
        );
        admitNote(0.02);

        await fn(0, 60, 0);

        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-early' }));
        // The clip-relative store cannot hold a negative beat, so the note
        // clamps at 0 inside the clip it was filed into.
        expect(create_midi_note).toHaveBeenCalledWith(60, 0, expect.any(Number), 100);
    });

    it('files an onset that lands inside a gap between clips into the nearer neighbor', async () => {
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                appendRecordedMidiNote: append_recorded_midi_note,
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            armed: true,
                            devices: [],
                            clips: [
                                { id: 'clip-head', type: 'midi', startBeat: 0, endBeat: 2 },
                                { id: 'clip-tail', type: 'midi', startBeat: 6, endBeat: 8 },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        admitNote(3.5);

        await fn(0, 60, 0);

        // Beat 3.5 sits in the gap: 1.5 beats from clip-head's end, 2.5 from
        // clip-tail's start. The last-clip fallback answered clip-tail.
        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-head' }));
    });

    // #4869 — the loop rescue keys on the region either coordinate puts the
    // onset in: a latency-rewound onset can sit before loopStart while the
    // musician's raw onset was inside the region, and the wrap must not
    // cost the note its loop clip.
    it('keeps the loop rescue for a compensated onset rewound before loopStart while the raw onset was inside the region', async () => {
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 4.02, duration: 2, velocity: 100 }));
        // 0.05 s at 120 BPM rewinds the heard onset 4.02 to beat 3.92, ahead
        // of the loop region [4, 8).
        audio_clock.baseLatency = 0.05;
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                getTransportStoreValue: () => ({
                    isRecording: true,
                    overdubEnabled: true,
                    isLooping: true,
                    loopStart: 4,
                    loopEnd: 8,
                    tempo: 120,
                }),
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            armed: true,
                            devices: [],
                            clips: [
                                { id: 'clip-loop-a', type: 'midi', startBeat: 4, endBeat: 6 },
                                { id: 'clip-loop-b', type: 'midi', startBeat: 6, endBeat: 8 },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        admitNote(4.02);

        await fn(0, 60, 0);

        // The loop's clips contain no beat 3.92; the nearest one in time is
        // the region's first clip. The old fallback answered clip-loop-b, the
        // track's last.
        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-loop-a' }));
        // Clip-relative: 3.92 against clip-loop-a's media origin (4) is
        // negative, so the store clamps at 0.
        expect(create_midi_note).toHaveBeenCalledWith(60, 0, expect.any(Number), 100);
    });
});
