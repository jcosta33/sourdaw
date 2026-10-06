import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { tempoMapStore } from '#/modules/Transport/stores';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const get_track_strip = vi.hoisted(() => vi.fn());
const audio_clock = vi.hoisted(() => ({ currentTime: 2, sampleRate: 48000, baseLatency: 0, outputLatency: 0 }));

// Injection seam adapted from the issue source, per its own escape hatch: the
// handler converts through the stores barrel's placement reads
// (`readSecondsAtBeat`/`readBeatAtSamples`), which read the live
// `tempoMapStore`, so the map is injected through the store's own API instead
// of a module mock (#4668).

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
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiNote: async () => true,
        soundsNativeNotes: () => false,
        ...overrides,
    };
}

// Audit #4591 — with a tempo map, `transport.tempo` is inert (setTempo.ts), yet
// a recorded note's length and its latency offset are converted with it.
describe('handleWebMidiNoteOff under a tempo map', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        get_track_strip.mockReset();
        mpe_enabled.value = false;
        audio_clock.currentTime = 2;
        audio_clock.baseLatency = 0;
        audio_clock.outputLatency = 0;
        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 60, curve: 'instant' }] });
    });

    afterEach(() => {
        tempoMapStore.set({ changes: [] });
    });

    it('records a note held for one second at 60 BPM as one beat long', async () => {
        const create_midi_note = vi.fn(() => ({
            id: 'note-recorded',
            pitch: 60,
            startBeat: 4,
            duration: 1,
            velocity: 100,
        }));
        // The transport's base tempo still reads 120; the map governing the
        // timeline runs at 60.
        const fn = handleWebMidiNoteOff._factory(make_dependencies({ createMidiNote: create_midi_note }));
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 4,
        });

        await fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 4, 1, 100);
    });

    // #4668 — the end of a hold must be read at the seconds the musician
    // heard, integrating from the latency-rewound origin exactly as the take
    // conversion does (`originSeconds + buffer.duration`). Integrating from
    // the raw onset misplaces the end of a hold across a tempo change by
    // `latency × Δtempo`.
    it('integrates a hold across a tempo change from the latency-rewound origin', async () => {
        // Map: 120 BPM up to beat 4, then 60. A note struck at beat 2 (1 s on
        // the map) and released 6.5 s later, with 0.5 s of latency, spans
        // [0.5 s, 7 s] of heard time — beat 1 through beat 9, eight beats.
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-1', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        audio_clock.baseLatency = 0.5;
        audio_clock.currentTime = 7.5;
        const create_midi_note = vi.fn(() => ({
            id: 'note-crossing',
            pitch: 60,
            startBeat: 1,
            duration: 8,
            velocity: 100,
        }));
        const fn = handleWebMidiNoteOff._factory(make_dependencies({ createMidiNote: create_midi_note }));
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 2,
        });

        await fn(0, 60, 0);

        // The raw-onset integration answers 7.5: it reads the end at the
        // uncompensated 7.5 s (beat 9.5) against the unwound start.
        expect(create_midi_note).toHaveBeenCalledWith(60, 1, 8, 100);
    });

    it('keeps a zero-latency hold across a tempo change at the raw-onset integration', async () => {
        // Without latency the rewound origin is the onset itself, so the span
        // is unchanged: [1 s, 7.5 s] reads beat 2 through beat 9.5.
        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tempo-1', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        audio_clock.currentTime = 7.5;
        const create_midi_note = vi.fn(() => ({
            id: 'note-crossing',
            pitch: 60,
            startBeat: 2,
            duration: 7.5,
            velocity: 100,
        }));
        const fn = handleWebMidiNoteOff._factory(make_dependencies({ createMidiNote: create_midi_note }));
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 1,
            startBeat: 2,
        });

        await fn(0, 60, 0);

        expect(create_midi_note).toHaveBeenCalledWith(60, 2, 7.5, 100);
    });
});
