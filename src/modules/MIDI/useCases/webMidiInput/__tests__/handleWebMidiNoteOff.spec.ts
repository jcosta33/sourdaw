import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const get_track_strip = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));

type TestMidiEvent = {
    timeSamples: number;
    kind: { type: 'noteOff'; channel: number; note: number };
};

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
                    clips: [{ id: 'clip-1', type: 'midi', startBeat: 0, endBeat: 8 }],
                },
            ],
            selectedTrackId: 'track-1',
        }),
        getTransportStoreValue: () => ({
            isRecording: true,
            overdubEnabled: false,
            isLooping: false,
            tempo: 120,
        }),
        playheadPositionRef: { current: 4 },
        createMidiNote: () => ({
            id: 'note-1',
            pitch: 60,
            startBeat: 4,
            duration: 2,
            velocity: 100,
        }),
        appendRecordedMidiNote: () => {},
        getSynthParamsForTrack: () => ({ release: 0.3 }),
        processRealtimeMidiInput: async () => [],
        stepRecordNoteOff: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        ...overrides,
    };
}

/**
 * Frame a live release lands on with the harness clock at 2 s / 48 kHz and no
 * event timestamp: the arrival frame plus the one-render-quantum scheduling
 * budget `resolveInputDispatchFrame` applies (audit MD-1).
 */
const LIVE_DISPATCH_FRAME = 96_128;
/** The same instant in seconds, for the fallback oscillator's release ramp. */
const LIVE_DISPATCH_TIME = LIVE_DISPATCH_FRAME / 48_000;
describe('handleWebMidiNoteOff', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        get_track_strip.mockReset();
        mpe_enabled.value = false;
        audio_clock.currentTime = 2;
        audio_clock.baseLatency = 0;
        audio_clock.outputLatency = 0;
    });

    it('should append recorded notes through the MIDI-owned append use case', async () => {
        const recorded_note = {
            id: 'note-recorded',
            pitch: 60,
            startBeat: 4,
            duration: 2,
            velocity: 100,
        };
        const create_midi_note = vi.fn(() => recorded_note);
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: typeof recorded_note }) => void>();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
            })
        );
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
        });

        await fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 4, 2, 100);
        expect(append_recorded_midi_note).toHaveBeenCalledWith({
            clipId: 'clip-1',
            note: recorded_note,
        });
    });

    it('should route Yeast note-off events through the rack to the instrument', async () => {
        const fermenter_note_off = vi.fn<(note: number, sampleFrame?: number) => void>();
        const process_realtime_midi_input = vi.fn(async (): Promise<TestMidiEvent[]> => [
            { timeSamples: 96_360, kind: { type: 'noteOff', channel: 0, note: 67 } },
        ]);
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'ferm-1', type: 'fermenter' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                getTransportStoreValue: () => ({ isRecording: false }),
                processRealtimeMidiInput: process_realtime_midi_input,
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                { type: 'fermenter', deviceId: 'ferm-1', fermenterControls: { noteOff: fermenter_note_off } },
            ],
        });
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
        });

        await fn(0, 60);

        expect(process_realtime_midi_input).toHaveBeenCalledTimes(1);
        expect(fermenter_note_off).toHaveBeenCalledWith(67, 96_360);
    });

    it('dispatches a missed Yeast note-off deadline at the current AudioContext frame', async () => {
        const fermenter_note_off = vi.fn<(note: number, sampleFrame?: number) => void>();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'ferm-1', type: 'fermenter' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                getTransportStoreValue: () => ({ isRecording: false }),
                processRealtimeMidiInput: async (): Promise<TestMidiEvent[]> => [
                    { timeSamples: 95_000, kind: { type: 'noteOff', channel: 0, note: 67 } },
                ],
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                { type: 'fermenter', deviceId: 'ferm-1', fermenterControls: { noteOff: fermenter_note_off } },
            ],
        });
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
        });

        await fn(0, 60);

        expect(fermenter_note_off).toHaveBeenCalledWith(67, 96_000);
    });

    it('releases a Yeast note on its originating track after selection changes', async () => {
        const fermenter_note_off = vi.fn<(note: number, sampleFrame?: number) => void>();
        const process_realtime_midi_input = vi.fn(async (): Promise<TestMidiEvent[]> => [
            { timeSamples: 96_480, kind: { type: 'noteOff', channel: 0, note: 67 } },
        ]);
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-a',
                            devices: [
                                { id: 'yeast-a', type: 'yeast' },
                                { id: 'ferm-a', type: 'fermenter' },
                            ],
                        },
                        { id: 'track-b', devices: [] },
                    ],
                    selectedTrackId: 'track-b',
                }),
                getTransportStoreValue: () => ({ isRecording: false }),
                processRealtimeMidiInput: process_realtime_midi_input,
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                { type: 'fermenter', deviceId: 'ferm-a', fermenterControls: { noteOff: fermenter_note_off } },
            ],
        });
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-a',
            instrumentTrackId: 'track-a',
            startTime: 0,
            startBeat: 0,
        });

        await fn(0, 60);

        expect(process_realtime_midi_input).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-a' }));
        expect(get_track_strip).toHaveBeenCalledWith('track-a');
        expect(fermenter_note_off).toHaveBeenCalledWith(67, 96_480);
    });

    it('should release a live synth oscillator through its envelope', async () => {
        const set_target_at_time = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
        const cancel_scheduled_values = vi.fn<(cancelTime: number) => void>();
        const stop = vi.fn<(when: number) => void>();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [] }],
                    selectedTrackId: 'track-1',
                }),
                getTransportStoreValue: () => ({ isRecording: false }),
                getSynthParamsForTrack: () => ({ release: 0.6 }),
            })
        );
        activeNotes.set(createWebMidiNoteKey(0, 64), {
            channel: 0,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: {
                _env: {
                    gain: {
                        cancelScheduledValues: cancel_scheduled_values,
                        setTargetAtTime: set_target_at_time,
                    },
                },
                stop,
            } as unknown as OscillatorNode & { _env?: GainNode },
        });

        await fn(0, 64);

        expect(cancel_scheduled_values).toHaveBeenCalledWith(LIVE_DISPATCH_TIME);
        expect(set_target_at_time).toHaveBeenCalledWith(0, LIVE_DISPATCH_TIME, 0.6 / 3);
        expect(stop).toHaveBeenCalledWith(LIVE_DISPATCH_TIME + 0.6 + 0.05);
    });

    it('should pass Grand Boule release velocity to controls and event payloads', async () => {
        const grand_boule_note_off =
            vi.fn<(note: number, pad: number | undefined, releaseVelocity: number, channel?: number) => void>();
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'gb-1', type: 'grand-boule' }] }],
                    selectedTrackId: 'track-1',
                }),
                getTransportStoreValue: () => ({ isRecording: false }),
                eventBus: {
                    emit: (type: string, payload: Record<string, unknown>) => {
                        emitted.push({ type, payload });
                        return Promise.resolve();
                    },
                    on: () => () => {},
                },
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                { type: 'grand-boule', deviceId: 'gb-1', grandBouleControls: { noteOff: grand_boule_note_off } },
            ],
        });
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            grandBouleDeviceId: 'gb-1',
        });

        await fn(0, 60, 96 / 127);

        expect(grand_boule_note_off).toHaveBeenCalledWith(60, LIVE_DISPATCH_FRAME, 96 / 127, 0);
        expect(emitted).toContainEqual({
            type: 'midi.noteOff',
            payload: { deviceId: 'gb-1', midiNote: 60, releaseVelocity: 96 / 127 },
        });
    });

    it('releases same-pitch notes on two channels through their original tracks', async () => {
        const note_off_a = vi.fn<(note: number, sampleFrame?: number, channel?: number) => void>();
        const note_off_b = vi.fn<(note: number, sampleFrame?: number, channel?: number) => void>();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        { id: 'track-a', devices: [{ id: 'ferm-a', type: 'fermenter' }] },
                        { id: 'track-b', devices: [{ id: 'ferm-b', type: 'fermenter' }] },
                    ],
                    selectedTrackId: 'track-b',
                }),
                getTransportStoreValue: () => ({ isRecording: false }),
            })
        );
        get_track_strip.mockImplementation((trackId: string) => ({
            deviceNodes: [
                trackId === 'track-a'
                    ? { deviceId: 'ferm-a', fermenterControls: { noteOff: note_off_a } }
                    : { deviceId: 'ferm-b', fermenterControls: { noteOff: note_off_b } },
            ],
        }));
        activeNotes.set(createWebMidiNoteKey(1, 60), {
            channel: 1,
            note: 60,
            trackId: 'track-a',
            instrumentTrackId: 'track-a',
            startTime: 0,
            startBeat: 0,
            fermenterDeviceId: 'ferm-a',
        });
        activeNotes.set(createWebMidiNoteKey(2, 60), {
            channel: 2,
            note: 60,
            trackId: 'track-b',
            instrumentTrackId: 'track-b',
            startTime: 0,
            startBeat: 0,
            fermenterDeviceId: 'ferm-b',
        });

        await fn(1, 60);
        await fn(2, 60);

        // Each release is narrowed to its own member channel, so the two
        // same-pitch notes cannot silence one another (audit MD-2).
        expect(note_off_a).toHaveBeenCalledWith(60, LIVE_DISPATCH_FRAME, 1);
        expect(note_off_b).toHaveBeenCalledWith(60, LIVE_DISPATCH_FRAME, 2);
        expect(activeNotes.size).toBe(0);
    });

    it('clears the matching channel identity even when MPE was disabled before release', async () => {
        const fn = handleWebMidiNoteOff._factory(make_dependencies());
        const noteKey = createWebMidiNoteKey(3, 60);
        activeNotes.set(noteKey, {
            channel: 3,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(3, noteKey);

        await fn(3, 60);

        expect(channelToNote.has(3)).toBe(false);
    });
    /// Regression (M-143): played velocity was discarded — every recorded
    /// note was written with velocity 100.
    it('records the played velocity instead of hardcoded 100', async () => {
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 4, duration: 2, velocity: 87 }));
        const fn = handleWebMidiNoteOff._factory(make_dependencies({ createMidiNote: create_midi_note }));
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            velocity: 87,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
        });

        await fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 4, 2, 87);
    });

    /// Regression (M-143): the recorded start beat was written
    /// timeline-absolute into the clip-relative store, so overdubbing into
    /// a clip not starting at beat 0 placed notes clip.startBeat late.
    it('stores recorded notes relative to the recording clip start', async () => {
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 2, duration: 2, velocity: 100 }));
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            armed: true,
                            devices: [],
                            clips: [{ id: 'clip-1', type: 'midi', startBeat: 8, endBeat: 16 }],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            velocity: 100,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 10, // timeline-absolute playhead beat at note-on
        });

        await fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 2, 2, 100);
    });

    it('overdubs onto the later clip when the playhead sits on the seam between two clips', async () => {
        // Two abutting clips share beat 8. An inclusive end bound makes both
        // ranges match, so `find` returns whichever is first in array order —
        // here the clip that has already ended.
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: { id: string } }) => void>();
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 0, duration: 2, velocity: 100 }));
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                getTransportStoreValue: () => ({
                    isRecording: true,
                    overdubEnabled: true,
                    isLooping: false,
                    tempo: 120,
                }),
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            armed: true,
                            devices: [],
                            clips: [
                                { id: 'clip-early', type: 'midi', startBeat: 0, endBeat: 8 },
                                { id: 'clip-late', type: 'midi', startBeat: 8, endBeat: 16 },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                playheadPositionRef: { current: 8 },
            })
        );
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            velocity: 100,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 8, // timeline-absolute playhead beat at note-on
        });

        await fn(0, 60, 0);

        expect(append_recorded_midi_note).toHaveBeenCalledWith(expect.objectContaining({ clipId: 'clip-late' }));
        // Clip-relative origin follows the resolved clip: beat 8 minus the
        // late clip's start (0), not minus the early clip's start (8).
        expect(create_midi_note).toHaveBeenCalledWith(60, 0, expect.any(Number), 100);
    });

    // The clip-relative store cannot hold a negative beat, so with the media
    // origin sitting exactly on the clip start every note played inside the
    // round-trip window clamps to 0 and loses its compensation — silently, and
    // unrecoverably. A clip that carries a media lead-in in `midiOffsetBeats`
    // puts the origin earlier than its start beat, which is what makes the
    // compensation representable. Punch recording creates exactly such a clip.
    it('keeps input-latency compensation for a note played inside a clip media lead-in', async () => {
        // 0.005 + 0.015 context + 0.010 track = 0.030 s; at 120 bpm, 0.06 beats.
        audio_clock.baseLatency = 0.005;
        audio_clock.outputLatency = 0.015;
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }));
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                getCompensationDelay: () => 0.01,
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            armed: true,
                            devices: [],
                            clips: [
                                {
                                    id: 'clip-punch',
                                    type: 'midi',
                                    startBeat: 16,
                                    endBeat: 24,
                                    midiOffsetBeats: 0.06,
                                },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                playheadPositionRef: { current: 16.03 },
            })
        );
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            velocity: 100,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            // Struck half a compensation window past the clip start.
            startBeat: 16.03,
        });

        await fn(0, 60, 0);

        // Media origin 16 - 0.06 = 15.94, so 16.03 - 0.06 - 15.94 = 0.03. Without
        // the lead-in the same strike resolves to -0.03 and clamps to 0.
        expect(create_midi_note).toHaveBeenCalledWith(60, expect.closeTo(0.03, 6), expect.any(Number), 100);
    });

    it('records MPE expression (pressure, slide, pitchBend) onto the captured note', async () => {
        mpe_enabled.value = true;
        const captured: Array<{ note: Record<string, unknown> }> = [];
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 4, duration: 2, velocity: 80 }));
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: Record<string, unknown> }) => void>(
            (input) => {
                captured.push({ note: input.note });
            }
        );
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({ createMidiNote: create_midi_note, appendRecordedMidiNote: append_recorded_midi_note })
        );
        activeNotes.set(createWebMidiNoteKey(1, 60), {
            channel: 1,
            note: 60,
            velocity: 80,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
            pressure: 42,
            slide: 30,
            pitchBend: -100,
        });

        await fn(1, 60, 0);

        expect(captured[0]?.note.pressure).toBe(42);
        expect(captured[0]?.note.slide).toBe(30);
        expect(captured[0]?.note.pitchBend).toBe(-100);
    });

    // audit MD-8, review round 1 — the wire delta alone has no depth. Without
    // the range beside it, playback re-interprets every recorded bend at the
    // MPE default: perform on a controller set to ±12 and it plays back four
    // times deeper than it sounded.
    it('records the bend range the note was performed under', async () => {
        mpe_enabled.value = true;
        const captured: Array<{ note: Record<string, unknown> }> = [];
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 4, duration: 2, velocity: 80 }));
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: Record<string, unknown> }) => void>(
            (input) => {
                captured.push({ note: input.note });
            }
        );
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({ createMidiNote: create_midi_note, appendRecordedMidiNote: append_recorded_midi_note })
        );
        activeNotes.set(createWebMidiNoteKey(1, 60), {
            channel: 1,
            note: 60,
            velocity: 80,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
            pitchBend: -4096,
            pitchBendRangeSemitones: 12,
        });

        await fn(1, 60, 0);

        expect(captured[0]?.note.pitchBendRangeSemitones).toBe(12);
    });

    it('leaves the range absent when the note carries no bend at all', async () => {
        mpe_enabled.value = true;
        const captured: Array<{ note: Record<string, unknown> }> = [];
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 4, duration: 2, velocity: 80 }));
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: Record<string, unknown> }) => void>(
            (input) => {
                captured.push({ note: input.note });
            }
        );
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({ createMidiNote: create_midi_note, appendRecordedMidiNote: append_recorded_midi_note })
        );
        activeNotes.set(createWebMidiNoteKey(1, 60), {
            channel: 1,
            note: 60,
            velocity: 80,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
            pressure: 42,
        });

        await fn(1, 60, 0);

        expect(captured[0]?.note.pitchBendRangeSemitones).toBeUndefined();
    });

    it('does not attach MPE expression when MPE is disabled', async () => {
        mpe_enabled.value = false;
        const captured: Array<{ note: Record<string, unknown> }> = [];
        const create_midi_note = vi.fn(() => ({ id: 'n', pitch: 60, startBeat: 4, duration: 2, velocity: 80 }));
        const append_recorded_midi_note = vi.fn<(input: { clipId: string; note: Record<string, unknown> }) => void>(
            (input) => {
                captured.push({ note: input.note });
            }
        );
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({ createMidiNote: create_midi_note, appendRecordedMidiNote: append_recorded_midi_note })
        );
        // Even though the live note carried expression, MPE is off so the recorded note must
        // carry only pitch/start/duration/velocity.
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            velocity: 80,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
            pressure: 42,
            slide: 30,
            pitchBend: -100,
        });

        await fn(0, 60, 0);

        expect(captured[0]?.note.pressure).toBeUndefined();
        expect(captured[0]?.note.slide).toBeUndefined();
        expect(captured[0]?.note.pitchBend).toBeUndefined();
    });

    it('skips recording when no clip is found for the armed track', async () => {
        const create_midi_note = vi.fn();
        const append_recorded_midi_note = vi.fn();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
                getTrackStoreState: () => ({
                    // Track is armed and transport is recording, but it has no midi clips.
                    tracks: [{ id: 'track-1', armed: true, devices: [], clips: [] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            velocity: 80,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
        });

        await fn(0, 60, 0);

        expect(create_midi_note).not.toHaveBeenCalled();
        expect(append_recorded_midi_note).not.toHaveBeenCalled();
    });

    it('should record the played note length rather than the handler-run interval', async () => {
        const recorded = { id: 'note-1', pitch: 60, startBeat: 4, duration: 1, velocity: 100 };
        const create_midi_note = vi.fn<
            (pitch: number, startBeat: number, duration: number, velocity: number) => typeof recorded
        >(() => recorded);
        const fn = handleWebMidiNoteOff._factory(make_dependencies({ createMidiNote: create_midi_note }));
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            // Arrival instant of the note-on, on the audio clock.
            startTime: 2,
            startBeat: 4,
            channel: 0,
            note: 60,
            velocity: 100,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
        });
        const performance_now = vi.spyOn(performance, 'now');

        // The key was released exactly 0.5 s after it was pressed, but the
        // note-off handler only ran 20 ms later. Wall-clock at handler-run time
        // would inflate the recorded length to 0.52 s / 1.04 beats (audit MD-1).
        audio_clock.currentTime = 2.52;
        performance_now.mockReturnValue(5020);
        await fn(0, 60, 0, 5000);

        expect(create_midi_note).toHaveBeenCalledTimes(1);
        // 0.5 s at 120 bpm is exactly one beat.
        expect(create_midi_note.mock.calls[0]![2]).toBeCloseTo(1, 9);

        performance_now.mockRestore();
    });
});
