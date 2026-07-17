import { describe, it, expect, vi, type Mock } from 'vitest';

import { type Store } from '#/infra/store/types';

import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { createDefaultGrandBouleState } from '../../stores/grandBouleStore';
import { triggerGrandBouleNote } from '../triggerGrandBouleNote';

type NoteOnArg = { midiNote: number; velocity: number };

function fakeEngine(overrides: Partial<GrandBouleEngineHandle> = {}): {
    handle: GrandBouleEngineHandle;
    noteOn: Mock<GrandBouleEngineHandle['noteOn']>;
} {
    const noteOn = vi.fn<GrandBouleEngineHandle['noteOn']>();
    return {
        noteOn,
        handle: {
            noteOn,
            noteOnMidi2: vi.fn(),
            noteOff: vi.fn(),
            setParam: vi.fn(),
            setSustain: vi.fn(),
            setUnaCorda: vi.fn(),
            setSostenuto: vi.fn(),
            setTemperament: vi.fn(),
            loadAttackClip: vi.fn(),
            allNotesOff: vi.fn(),
            isReady: () => true,
            getAnalyserNode: () => null,
            sampleRate: () => 48000,
            ...overrides,
        },
    };
}

function storeWith(value: GrandBouleState | null): Store<GrandBouleState> {
    return { value } as Store<GrandBouleState>;
}

function firstNoteOnArg(noteOn: Mock<GrandBouleEngineHandle['noteOn']>): NoteOnArg {
    const call = noteOn.mock.calls[0];
    if (!call) {
        throw new Error('expected noteOn to have been called');
    }
    return call[0];
}

describe('triggerGrandBouleNote', () => {
    it('should export triggerGrandBouleNote', () => {
        expect(triggerGrandBouleNote).toBeDefined();
    });

    it('shapes velocity through the calibration curve', () => {
        // exponent 2 with full range squares the normalised velocity.
        const calibration = {
            ...createDefaultMidiCalibration(),
            velocityCurveExponent: 2,
            velocityFloor: 0,
            velocityCeiling: 1,
        };
        const state = { ...createDefaultGrandBouleState(), midiCalibration: calibration };
        const { handle, noteOn } = fakeEngine();

        triggerGrandBouleNote({ engine: handle, store: storeWith(state), midiNote: 60, velocity: 0.5 });

        expect(noteOn).toHaveBeenCalledTimes(1);
        expect(firstNoteOnArg(noteOn).velocity).toBeCloseTo(0.25, 12);
    });

    it('respects the calibration floor and ceiling', () => {
        const calibration = {
            ...createDefaultMidiCalibration(),
            velocityCurveExponent: 1,
            velocityFloor: 0.2,
            velocityCeiling: 0.8,
        };
        const state = { ...createDefaultGrandBouleState(), midiCalibration: calibration };
        const { handle, noteOn } = fakeEngine();

        triggerGrandBouleNote({ engine: handle, store: storeWith(state), midiNote: 60, velocity: 0.5 });

        // 0.2 + 0.5 * (0.8 - 0.2) = 0.5
        expect(firstNoteOnArg(noteOn).velocity).toBeCloseTo(0.5, 12);
    });

    // Regression: prior #23/#26/#42/#27/#24 — when the store has not hydrated,
    // the velocity was forwarded raw and UNCLAMPED, so an out-of-range value
    // reached the engine on the first note but was clamped on every later note.
    it('clamps an out-of-range velocity even when the store is uninitialised', () => {
        const over = fakeEngine();
        triggerGrandBouleNote({ engine: over.handle, store: storeWith(null), midiNote: 60, velocity: 1.5 });
        expect(firstNoteOnArg(over.noteOn).velocity).toBe(1);

        const under = fakeEngine();
        triggerGrandBouleNote({ engine: under.handle, store: storeWith(null), midiNote: 60, velocity: -0.2 });
        expect(firstNoteOnArg(under.noteOn).velocity).toBe(0);
    });

    it('forwards the same shaped velocity whether the store is null or default-calibrated', () => {
        const nullStore = fakeEngine();
        triggerGrandBouleNote({ engine: nullStore.handle, store: storeWith(null), midiNote: 60, velocity: 0.42 });

        const defaultStore = fakeEngine();
        triggerGrandBouleNote({
            engine: defaultStore.handle,
            store: storeWith(createDefaultGrandBouleState()),
            midiNote: 60,
            velocity: 0.42,
        });

        expect(firstNoteOnArg(nullStore.noteOn).velocity).toBe(firstNoteOnArg(defaultStore.noteOn).velocity);
    });

    it('does nothing when the engine is not ready', () => {
        const { handle, noteOn } = fakeEngine({ isReady: () => false });
        triggerGrandBouleNote({
            engine: handle,
            store: storeWith(createDefaultGrandBouleState()),
            midiNote: 60,
            velocity: 0.5,
        });
        expect(noteOn).not.toHaveBeenCalled();
    });
});
