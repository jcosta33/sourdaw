import { describe, it, expect, vi } from 'vitest';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { triggerGrandBouleMicrotunedNote } from '../triggerGrandBouleMicrotunedNote';

const Q24_PER_SEMITONE = 1 << 24;

type NoteOnMidi2 = GrandBouleEngineHandle['noteOnMidi2'];

function fakeEngine(): { handle: GrandBouleEngineHandle; noteOnMidi2: ReturnType<typeof vi.fn<NoteOnMidi2>> } {
    const noteOnMidi2 = vi.fn<NoteOnMidi2>();
    return {
        noteOnMidi2,
        handle: {
            noteOn: vi.fn(),
            noteOnMidi2,
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
        },
    };
}

describe('triggerGrandBouleMicrotunedNote', () => {
    it('converts a cents offset to the engine Q24 semitone format', () => {
        const { handle, noteOnMidi2 } = fakeEngine();

        // +50 cents = half a semitone -> 0.5 * 2^24.
        triggerGrandBouleMicrotunedNote({ engine: handle, midiNote: 69, velocity16bit: 32000, offsetCents: 50 });

        expect(noteOnMidi2).toHaveBeenCalledTimes(1);
        expect(noteOnMidi2).toHaveBeenCalledWith({
            midiNote: 69,
            velocity16bit: 32000,
            pitchOffsetQ24: Math.round(0.5 * Q24_PER_SEMITONE),
        });
    });

    it('carries a negative cents offset as a signed Q24 value', () => {
        const { handle, noteOnMidi2 } = fakeEngine();

        triggerGrandBouleMicrotunedNote({ engine: handle, midiNote: 60, velocity16bit: 1, offsetCents: -100 });

        // -100 cents = -1 semitone -> -2^24.
        expect(noteOnMidi2.mock.calls[0]![0].pitchOffsetQ24).toBe(-Q24_PER_SEMITONE);
    });

    it('clamps 16-bit velocity into the 0..65535 range', () => {
        const { handle, noteOnMidi2 } = fakeEngine();

        triggerGrandBouleMicrotunedNote({ engine: handle, midiNote: 60, velocity16bit: 70000, offsetCents: 0 });
        triggerGrandBouleMicrotunedNote({ engine: handle, midiNote: 60, velocity16bit: -5, offsetCents: 0 });

        expect(noteOnMidi2.mock.calls[0]![0].velocity16bit).toBe(0xffff);
        expect(noteOnMidi2.mock.calls[1]![0].velocity16bit).toBe(0);
    });

    it('rounds a fractional 16-bit velocity to the nearest integer', () => {
        const { handle, noteOnMidi2 } = fakeEngine();

        triggerGrandBouleMicrotunedNote({ engine: handle, midiNote: 60, velocity16bit: 100.6, offsetCents: 0 });

        expect(noteOnMidi2.mock.calls[0]![0].velocity16bit).toBe(101);
    });
});
