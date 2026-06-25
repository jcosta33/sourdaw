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
const { fermenterNoteOff, getTrackStrip, ensureTrackStrip } = vi.hoisted(() => ({
    fermenterNoteOff: vi.fn<(note: number, sampleFrame?: number) => void>(),
    getTrackStrip: vi.fn(),
    ensureTrackStrip: vi.fn(),
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
        ensureTrackStrip: (id: string) => ensureTrackStrip(id) as unknown,
    },
}));

// Import after mocks so the handler binds to the mocked singletons.
const { handleNoteOff, handleNoteOn } = await import('../messageHandlers');
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
    ensureTrackStrip.mockReset();
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

describe('GrandBoule midi.note* emits carry deviceId (panel-filter isolation)', () => {
    // GrandBoulePanel filters incoming midi.noteOn/noteOff by deviceId:
    //   if (eventDeviceId && eventDeviceId !== deviceId) return;
    // An emit with NO deviceId is undefined → falsy → the guard is skipped and
    // the event applies to EVERY open panel. So every GrandBoule midi.note* emit
    // must carry its own deviceId, or a note on/off for one device visually
    // bleeds into all other open GrandBoule panels.

    const GB_DEVICE_ID = 'gb-1';

    function captureEmits(deps: Deps): Array<{ type: string; payload: Record<string, unknown> }> {
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        (deps as { eventBus: { emit: (type: string, payload: Record<string, unknown>) => Promise<void> } }).eventBus = {
            emit: (type, payload) => {
                emitted.push({ type, payload });
                return Promise.resolve();
            },
        };
        return emitted;
    }

    it('threads release velocity from the Note Off through to engine.noteOff and the emit payload', () => {
        // Round-2 regression: the MidiNoteOffPayload.releaseVelocity field existed
        // but no emitter populated it and it was never passed to engine.noteOff.
        // A non-zero release velocity supplied to handleNoteOff must reach BOTH
        // grandBouleControls.noteOff (the engine boundary) AND the midi.noteOff
        // event payload — not be dropped at the handler.
        const gbTrack = { id: 'track-1', devices: [{ id: GB_DEVICE_ID, type: 'grand-boule' }] };
        const deps = {
            ...makeDeps(() => []),
            getTrackStoreState: () => ({ tracks: [gbTrack], selectedTrackId: 'track-1' }),
        } as unknown as Deps;
        const emitted = captureEmits(deps);

        const grandBouleNoteOff = vi.fn<(midiNote: number, sampleFrame?: number, releaseVelocity?: number) => void>();
        getTrackStrip.mockReturnValue({
            deviceNodes: [
                { type: 'grand-boule', deviceId: GB_DEVICE_ID, grandBouleControls: { noteOff: grandBouleNoteOff } },
            ],
        });

        const fn = handleNoteOff._factory(deps);
        activeNotes.set(60, { channel: 0, startTime: 0, startBeat: 0, grandBouleDeviceId: GB_DEVICE_ID });

        // 96/127 — the normalized value onMidiMessage would compute from data[2]=96.
        const releaseVelocity = 96 / 127;
        fn(0, 60, releaseVelocity);

        // Reached the engine boundary: noteOff(midiNote, sampleFrame, releaseVelocity).
        expect(grandBouleNoteOff).toHaveBeenCalledTimes(1);
        expect(grandBouleNoteOff).toHaveBeenCalledWith(60, undefined, releaseVelocity);

        // Reached the event payload (panels / subscribers read it from here).
        const off = emitted.find((event) => event.type === 'midi.noteOff');
        expect(off).toBeDefined();
        expect(off!.payload.releaseVelocity).toBe(releaseVelocity);
    });

    it('non-Yeast Note Off emits midi.noteOff with the device id, not a bare midiNote', () => {
        // Plain GrandBoule track (no Yeast): the Note Off runs the
        // noteData.grandBouleDeviceId branch, which emits midi.noteOff.
        const gbTrack = { id: 'track-1', devices: [{ id: GB_DEVICE_ID, type: 'grand-boule' }] };
        const deps = {
            ...makeDeps(() => []),
            getTrackStoreState: () => ({ tracks: [gbTrack], selectedTrackId: 'track-1' }),
        } as unknown as Deps;
        const emitted = captureEmits(deps);

        getTrackStrip.mockReturnValue({
            deviceNodes: [{ type: 'grand-boule', deviceId: GB_DEVICE_ID, grandBouleControls: { noteOff: vi.fn() } }],
        });

        const fn = handleNoteOff._factory(deps);
        // The note was sounded on this GrandBoule device, so its id is tracked.
        activeNotes.set(60, { channel: 0, startTime: 0, startBeat: 0, grandBouleDeviceId: GB_DEVICE_ID });

        fn(0, 60);

        const off = emitted.find((event) => event.type === 'midi.noteOff');
        expect(off).toBeDefined();
        // Regression: before the fix the payload was { midiNote: 60 } with no
        // deviceId, which leaks the visual note-off to every open panel.
        expect(off!.payload.deviceId).toBe(GB_DEVICE_ID);
        expect(off!.payload.midiNote).toBe(60);
    });

    it('Yeast-routed Note On emits midi.noteOn with the device id, not a bare midiNote', () => {
        // Yeast + GrandBoule track (no fermenter): handleNoteOn routes through the
        // rack, then the rack-produced noteOn drives the GrandBoule branch + emit.
        const yeastGbTrack = {
            id: 'track-1',
            parentId: undefined,
            devices: [
                { id: 'yeast-1', type: 'yeast' },
                { id: GB_DEVICE_ID, type: 'grand-boule' },
            ],
        };
        const deps = {
            ...makeDeps((): MidiEvent[] => [
                { timeSamples: 0, kind: { type: 'noteOn', channel: 0, note: 67, velocity: 100 } },
            ]),
            getTrackStoreState: () => ({ tracks: [yeastGbTrack], selectedTrackId: 'track-1' }),
        } as unknown as Deps;
        const emitted = captureEmits(deps);

        ensureTrackStrip.mockReturnValue({
            gainNode: {},
            deviceNodes: [{ type: 'grand-boule', deviceId: GB_DEVICE_ID, grandBouleControls: { noteOn: vi.fn() } }],
        });

        const fn = handleNoteOn._factory(deps);
        fn(0, 60, 100);

        const on = emitted.find((event) => event.type === 'midi.noteOn');
        expect(on).toBeDefined();
        // Regression: before the fix the Yeast path emitted { midiNote, velocity }
        // with no deviceId, highlighting the note on every open GrandBoule panel.
        expect(on!.payload.deviceId).toBe(GB_DEVICE_ID);
        expect(on!.payload.midiNote).toBe(67);
    });
});
