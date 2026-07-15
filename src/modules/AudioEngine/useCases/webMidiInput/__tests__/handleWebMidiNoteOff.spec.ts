import { beforeEach, describe, expect, it, vi } from 'vitest';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const get_track_strip = vi.hoisted(() => vi.fn());

type TestMidiEvent = {
    timeSamples: number;
    kind: { type: 'noteOff'; channel: number; note: number };
};

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            currentTime: 2,
            sampleRate: 48000,
            baseLatency: 0,
            outputLatency: 0,
        },
        getTrackStrip: get_track_strip,
    },
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
    } as unknown as HandleWebMidiNoteOffDependencies;
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
        const append_recorded_midi_note = vi.fn<void, [{ clipId: string; note: typeof recorded_note }]>();
        const fn = handleWebMidiNoteOff._factory(
            make_dependencies({
                createMidiNote: create_midi_note,
                appendRecordedMidiNote: append_recorded_midi_note,
            })
        );
        activeNotes.set(60, { channel: 0, trackId: 'track-1', startTime: 1, startBeat: 4 });

        await fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 4, 2, 100);
        expect(append_recorded_midi_note).toHaveBeenCalledWith({
            clipId: 'clip-1',
            note: recorded_note,
        });
    });

    it('should route Yeast note-off events through the rack to the instrument', async () => {
        const fermenter_note_off = vi.fn<void, [number]>();
        const process_realtime_midi_input = vi.fn(
            async (): Promise<TestMidiEvent[]> => [{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 67 } }]
        );
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
        activeNotes.set(60, { channel: 0, trackId: 'track-1', startTime: 0, startBeat: 0 });

        await fn(0, 60);

        expect(process_realtime_midi_input).toHaveBeenCalledTimes(1);
        expect(fermenter_note_off).toHaveBeenCalledWith(67);
    });

    it('releases a Yeast note on its originating track after selection changes', async () => {
        const fermenter_note_off = vi.fn<void, [number]>();
        const process_realtime_midi_input = vi.fn(
            async (): Promise<TestMidiEvent[]> => [{ timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 67 } }]
        );
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
        activeNotes.set(60, { channel: 0, trackId: 'track-a', startTime: 0, startBeat: 0 });

        await fn(0, 60);

        expect(process_realtime_midi_input).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-a' }));
        expect(get_track_strip).toHaveBeenCalledWith('track-a');
        expect(fermenter_note_off).toHaveBeenCalledWith(67);
    });

    it('should release a live synth oscillator through its envelope', async () => {
        const set_target_at_time = vi.fn<void, [number, number, number]>();
        const cancel_scheduled_values = vi.fn<void, [number]>();
        const stop = vi.fn<void, [number]>();
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
        activeNotes.set(64, {
            channel: 0,
            trackId: 'track-1',
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
        const grand_boule_note_off = vi.fn<void, [number, number | undefined, number]>();
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
        activeNotes.set(60, {
            channel: 0,
            trackId: 'track-1',
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
});
