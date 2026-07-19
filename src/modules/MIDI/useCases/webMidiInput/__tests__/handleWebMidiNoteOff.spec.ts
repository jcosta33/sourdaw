import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const get_track_strip = vi.hoisted(() => vi.fn());

type TestMidiEvent = {
    timeSamples: number;
    kind: { type: 'noteOff'; channel: number; note: number };
};

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: {
            currentTime: 2,
            sampleRate: 48000,
            baseLatency: 0,
            outputLatency: 0,
        },
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

describe('handleWebMidiNoteOff', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        get_track_strip.mockReset();
        mpe_enabled.value = false;
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

        expect(cancel_scheduled_values).toHaveBeenCalledWith(2);
        expect(set_target_at_time).toHaveBeenCalledWith(0, 2, 0.6 / 3);
        expect(stop).toHaveBeenCalledWith(2 + 0.6 + 0.05);
    });

    it('should pass Grand Boule release velocity to controls and event payloads', async () => {
        const grand_boule_note_off = vi.fn<(note: number, pad: number | undefined, releaseVelocity: number) => void>();
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

        expect(grand_boule_note_off).toHaveBeenCalledWith(60, undefined, 96 / 127);
        expect(emitted).toContainEqual({
            type: 'midi.noteOff',
            payload: { deviceId: 'gb-1', midiNote: 60, releaseVelocity: 96 / 127 },
        });
    });

    it('releases same-pitch notes on two channels through their original tracks', async () => {
        const note_off_a = vi.fn<(note: number) => void>();
        const note_off_b = vi.fn<(note: number) => void>();
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

        expect(note_off_a).toHaveBeenCalledWith(60);
        expect(note_off_b).toHaveBeenCalledWith(60);
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
});
