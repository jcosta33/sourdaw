import { beforeEach, describe, expect, it, vi } from 'vitest';

const target_track_id = vi.hoisted(() => ({ value: 'track-1' as string | null }));
const ensure_track_strip = vi.hoisted(() => vi.fn());

type TestMidiEvent = {
    timeSamples: number;
    kind:
        | { type: 'noteOn'; channel: number; note: number; velocity: number }
        | { type: 'noteOff'; channel: number; note: number };
};

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => false,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => target_track_id.value,
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 2, sampleRate: 48000 },
        ensureTrackStrip: ensure_track_strip,
    },
}));

const { handleWebMidiNoteOn } = await import('../handleWebMidiNoteOn');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

type HandleWebMidiNoteOnDependencies = Parameters<typeof handleWebMidiNoteOn._factory>[0];

function make_dependencies(overrides: Partial<HandleWebMidiNoteOnDependencies> = {}): HandleWebMidiNoteOnDependencies {
    return {
        getTrackStoreState: () => ({
            tracks: [{ id: 'track-1', devices: [] }],
            selectedTrackId: 'track-1',
        }),
        getTransportStoreValue: () => ({ isRecording: false }),
        playheadPositionRef: { current: 0 },
        stepRecordNoteOn: () => {},
        processRealtimeMidiInput: async () => [],
        getSynthParamsForTrack: () => ({ detune: 0, release: 0.3 }),
        scheduleNote: () => null,
        scheduleKitNote: () => null,
        getDrumKitByIndex: () => null,
        getDrumKitDefByIndex: () => null,
        scheduleDrumKitNote: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        handleWebMidiNoteOff: async () => {},
        ...overrides,
    } as unknown as HandleWebMidiNoteOnDependencies;
}

describe('handleWebMidiNoteOn', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        ensure_track_strip.mockReset();
        target_track_id.value = 'track-1';
    });

    it('should emit Yeast-routed Grand Boule note-on events with the device id', async () => {
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const grand_boule_note_on = vi.fn<void, [number, number]>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'gb-1', type: 'grand-boule' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: async (): Promise<TestMidiEvent[]> => [
                    { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
                ],
                eventBus: {
                    emit: (type: string, payload: Record<string, unknown>) => {
                        emitted.push({ type, payload });
                        return Promise.resolve();
                    },
                    on: () => () => {},
                },
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                { type: 'grand-boule', deviceId: 'gb-1', grandBouleControls: { noteOn: grand_boule_note_on } },
            ],
        });

        await fn(0, 60, 100);

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127);
        expect(emitted).toContainEqual({
            type: 'midi.noteOn',
            payload: { deviceId: 'gb-1', midiNote: 67, velocity: 100 / 127 },
        });
    });

    it('should await the Yeast runtime before routing transformed note-ons', async () => {
        const grand_boule_note_on = vi.fn<void, [number, number]>();
        const fn = handleWebMidiNoteOn._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [
                        {
                            id: 'track-1',
                            devices: [
                                { id: 'yeast-1', type: 'yeast' },
                                { id: 'gb-1', type: 'grand-boule' },
                            ],
                        },
                    ],
                    selectedTrackId: 'track-1',
                }),
                processRealtimeMidiInput: vi.fn(async () => [
                    { timeSamples: 0, kind: { type: 'noteOn' as const, channel: 0, note: 67, velocity: 100 } },
                ]),
            })
        );
        ensure_track_strip.mockReturnValue({
            gainNode: {},
            deviceNodes: [
                { type: 'grand-boule', deviceId: 'gb-1', grandBouleControls: { noteOn: grand_boule_note_on } },
            ],
        });

        await fn(0, 60, 100);

        expect(grand_boule_note_on).toHaveBeenCalledWith(67, 100 / 127);
    });
});
