/**
 * Handler-level regression tests for the live-keyboard Note Off path through the
 * Yeast rack (CRITICAL #62). A Note Off for a Yeast-armed track must be routed
 * through `processRealtimeMidiInput` so the rack reverses any note mapping it
 * applied on Note On, and each resulting Note Off must reach the instrument
 * exactly once (no double-off).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiEvent } from '#/modules/Yeast/useCases';

// The handler reads these module-level singletons (not injected deps); mock them
// so the test owns the target track, the active-note map, and the track strip.
// `vi.hoisted` makes the shared spies available inside the hoisted mock factory.
const { fermenterNoteOff, getTrackStrip } = vi.hoisted(() => ({
    fermenterNoteOff: vi.fn<(note: number, sampleFrame?: number) => void>(),
    getTrackStrip: vi.fn(),
}));

// NOTE: mock specifiers are resolved against this test file's location; the
// module-under-test (`../messageHandlers`) imports `./state` and
// `../createWebAudioEngine`, which from here are `../state` and
// `../../createWebAudioEngine`.
vi.mock('../state', () => ({
    activeNotes: new Map<number, { channel: number; startTime: number; startBeat: number }>(),
    channelToNote: new Map<number, number>(),
    getMpeEnabled: () => false,
    getTargetTrackId: () => 'track-1',
}));

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 1, sampleRate: 48000 },
        getTrackStrip: (id: string) => getTrackStrip(id) as unknown,
    },
}));

// Import after mocks so the handler binds to the mocked singletons.
const { handleNoteOff } = await import('../messageHandlers');
const { activeNotes } = await import('../state');

type Deps = Parameters<typeof handleNoteOff._factory>[0];

const yeastTrack = {
    id: 'track-1',
    devices: [
        { id: 'yeast-1', type: 'yeast' },
        { id: 'ferm-1', type: 'fermenter' },
    ],
};

function makeDeps(processRealtimeMidiInput: (...args: unknown[]) => MidiEvent[]): Deps {
    return {
        getCompensationDelay: () => 0,
        getMidiStoreState: () => null,
        setMidiStoreState: () => {},
        getTrackStoreState: () => ({ tracks: [yeastTrack], selectedTrackId: 'track-1' }),
        getMidiLearnState: () => null,
        createMidiNote: () => ({}),
        getTransportStoreValue: () => ({ isRecording: false }),
        playheadPositionRef: { current: 0 },
        completeMidiLearn: () => {},
        applyMidiMappings: () => {},
        getSynthParamsForTrack: () => null,
        scheduleNote: () => null,
        scheduleKitNote: () => null,
        getDrumKitByIndex: () => null,
        getDrumKitDefByIndex: () => null,
        scheduleDrumKitNote: () => {},
        processRealtimeMidiInput,
        stepRecordNoteOn: () => {},
        stepRecordNoteOff: () => {},
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
    } as unknown as Deps;
}

beforeEach(() => {
    fermenterNoteOff.mockReset();
    getTrackStrip.mockReset();
    activeNotes.clear();
    getTrackStrip.mockReturnValue({
        deviceNodes: [{ type: 'fermenter', deviceId: 'ferm-1', fermenterControls: { noteOff: fermenterNoteOff } }],
    });
});

describe('handleNoteOff — Yeast-track Note Off through the rack (CRITICAL #62)', () => {
    it('routes the Note Off through processRealtimeMidiInput and forwards it to the instrument', () => {
        // The rack maps note 60 → 67 (e.g. a Transposer); its Note Off carries
        // the mapped note, which is what must reach the instrument.
        const processRealtimeMidiInput = vi.fn((): MidiEvent[] => [
            { timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 67 } },
        ]);
        const fn = handleNoteOff._factory(makeDeps(processRealtimeMidiInput));

        // A note must be tracked as active for handleNoteOff to proceed.
        activeNotes.set(60, { channel: 0, startTime: 0, startBeat: 0 });

        fn(0, 60);

        // The Note Off went through the rack (not raw note 60)...
        expect(processRealtimeMidiInput).toHaveBeenCalledTimes(1);
        // ...and the rack's mapped Note Off reached the instrument exactly once.
        expect(fermenterNoteOff).toHaveBeenCalledTimes(1);
        expect(fermenterNoteOff).toHaveBeenCalledWith(67);
    });

    it('does not double-off: a single rack Note Off triggers a single instrument Note Off', () => {
        const processRealtimeMidiInput = vi.fn((): MidiEvent[] => [
            { timeSamples: 0, kind: { type: 'noteOff', channel: 0, note: 60 } },
        ]);
        const fn = handleNoteOff._factory(makeDeps(processRealtimeMidiInput));
        activeNotes.set(60, { channel: 0, startTime: 0, startBeat: 0 });

        fn(0, 60);

        // The Yeast branch routes via processedEvents; the raw-key branch below
        // it is gated on noteData.fermenterDeviceId (never set on the Yeast
        // path), so the instrument is told to stop the note exactly once.
        expect(fermenterNoteOff).toHaveBeenCalledTimes(1);
    });
});

describe('handleNoteOff — built-in synth smooth release via osc._env', () => {
    // The active note must be a non-Yeast synth note, so use a plain track with
    // no Yeast/instrument device; only the bottom oscillator-release branch runs.
    function makeSynthDeps(): Deps {
        const deps = makeDeps(() => []);
        return {
            ...deps,
            getTrackStoreState: () => ({ tracks: [{ id: 'track-1', devices: [] }], selectedTrackId: 'track-1' }),
            getSynthParamsForTrack: () => ({ release: 0.6 }),
        } as unknown as Deps;
    }

    it('applies the exponential release through osc._env instead of hard-stopping', () => {
        const setTargetAtTime = vi.fn();
        const cancelScheduledValues = vi.fn();
        const stop = vi.fn();
        const fn = handleNoteOff._factory(makeSynthDeps());

        // scheduleNote attaches the amplitude-envelope GainNode as `_env`; the
        // live-MIDI Note Off must drive the smooth release through it. Before the
        // fix `_env` was never set so this branch was dead and the note hard-stopped.
        activeNotes.set(64, {
            channel: 0,
            startTime: 0,
            startBeat: 0,
            osc: {
                _env: { gain: { setTargetAtTime, cancelScheduledValues } },
                stop,
            } as unknown as NonNullable<ReturnType<typeof activeNotes.get>>['osc'],
        });

        fn(0, 64);

        expect(cancelScheduledValues).toHaveBeenCalledTimes(1);
        expect(setTargetAtTime).toHaveBeenCalledTimes(1);
        // setTargetAtTime(target=0, now, timeConstant=release/3) with release 0.6.
        expect(setTargetAtTime).toHaveBeenCalledWith(0, expect.any(Number), 0.6 / 3);
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
