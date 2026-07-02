import { beforeEach, describe, expect, it, vi } from 'vitest';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const target_track_id = vi.hoisted(() => ({ value: 'track-1' as string | null }));
const get_track_strip = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => target_track_id.value,
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
        processRealtimeMidiInput: () => [],
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
        target_track_id.value = 'track-1';
    });

    it('should append recorded notes through the MIDI-owned append use case', () => {
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
        activeNotes.set(60, { channel: 0, startTime: 1, startBeat: 4 });

        fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 4, 2, 100);
        expect(append_recorded_midi_note).toHaveBeenCalledWith({
            clipId: 'clip-1',
            note: recorded_note,
        });
    });
});
