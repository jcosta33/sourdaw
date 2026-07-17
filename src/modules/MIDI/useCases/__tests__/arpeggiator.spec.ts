import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { arpeggiate } from '../arpeggiator';

type StoreValue = { notesByClipId: Record<string, Partial<MidiNote>[]> };

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {} } as StoreValue },
    midiStoreSet: vi.fn<(next: StoreValue) => void>(),
}));

vi.mock('../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

type SetNotes = Partial<MidiNote>[];

function notesFromSetCall(callIndex: number): SetNotes {
    const call = mocks.midiStoreSet.mock.calls[callIndex];
    if (!call) {
        throw new Error(`Expected midiStore.set call at index ${String(callIndex)}`);
    }
    const notes = call[0].notesByClipId.c1;
    if (!notes) {
        throw new Error('Expected notes for clip c1');
    }
    return notes;
}

function noteAt(notes: SetNotes, index: number): Partial<MidiNote> {
    const note = notes[index];
    if (!note) {
        throw new Error(`Expected note at index ${String(index)}`);
    }
    return note;
}

function idsFromSetCall(callIndex: number): string[] {
    return notesFromSetCall(callIndex).map((node) => {
        if (!node.id) {
            throw new Error('Expected note id');
        }
        return node.id;
    });
}

describe('arpeggiate', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates an "up" pattern for a single chord', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [
                    { pitch: 64, startBeat: 0, duration: 4, velocity: 100 },
                    { pitch: 60, startBeat: 0, duration: 4, velocity: 100 },
                    { pitch: 67, startBeat: 0, duration: 4, velocity: 100 },
                ],
            },
        };

        // Rate 8 -> step size 0.5. 4 beats / 0.5 = 8 notes.
        arpeggiate('c1', 'up', 8, 1, 100);

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const newNotes = notesFromSetCall(0);
        expect(newNotes).toHaveLength(8);

        // Up pattern on C (60), E (64), G (67)
        expect(noteAt(newNotes, 0).pitch).toBe(60);
        expect(noteAt(newNotes, 1).pitch).toBe(64);
        expect(noteAt(newNotes, 2).pitch).toBe(67);
        expect(noteAt(newNotes, 3).pitch).toBe(60);

        expect(noteAt(newNotes, 0).startBeat).toBe(0);
        expect(noteAt(newNotes, 1).startBeat).toBe(0.5);
    });

    it('expands octaves', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ pitch: 60, startBeat: 0, duration: 1 }] },
        };

        // Rate 4 -> step size 1. 1 beat / 1 = 1 note.
        // 2 octaves.
        arpeggiate('c1', 'up', 4, 2);

        const newNotes = notesFromSetCall(0);
        // The loop is beat < maxBeat. 0 < 1. Only 1 note.
        // Wait, maxBeat is start + duration. 0 + 1 = 1.
        expect(newNotes).toHaveLength(1);
        expect(noteAt(newNotes, 0).pitch).toBe(60);

        // If duration was longer:
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ pitch: 60, startBeat: 0, duration: 2 }] },
        };
        arpeggiate('c1', 'up', 4, 2);
        const notes2 = notesFromSetCall(1);
        expect(notes2).toHaveLength(2);
        expect(noteAt(notes2, 0).pitch).toBe(60);
        expect(noteAt(notes2, 1).pitch).toBe(72); // +1 octave
    });

    it('mints globally unique note ids (no arp-${clipId}-${index} collisions)', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ pitch: 60, startBeat: 0, duration: 4, velocity: 100 }],
            },
        };

        arpeggiate('c1', 'up', 8, 1, 100);
        const ids = idsFromSetCall(0);
        // All ids unique within one run...
        expect(new Set(ids).size).toBe(ids.length);
        // ...and not the old deterministic positional scheme.
        expect(ids.some((id) => /^arp-c1-\d+$/.test(id))).toBe(false);

        // A second run on the same clip must not reuse the first run's ids.
        arpeggiate('c1', 'up', 8, 1, 100);
        const ids2 = idsFromSetCall(1);
        expect(ids.some((id) => ids2.includes(id))).toBe(false);
    });

    it('produces a deterministic random shuffle for a given seed', () => {
        const chord = [
            { pitch: 60, startBeat: 0, duration: 4, velocity: 100 },
            { pitch: 62, startBeat: 0, duration: 4, velocity: 100 },
            { pitch: 64, startBeat: 0, duration: 4, velocity: 100 },
            { pitch: 65, startBeat: 0, duration: 4, velocity: 100 },
            { pitch: 67, startBeat: 0, duration: 4, velocity: 100 },
        ];

        mocks.midiStoreValue.value = { notesByClipId: { c1: chord } };
        arpeggiate('c1', 'random', 16, 1, 100, 'replace', 12345);
        const first = notesFromSetCall(0).map((node) => node.pitch);

        mocks.midiStoreValue.value = { notesByClipId: { c1: chord } };
        arpeggiate('c1', 'random', 16, 1, 100, 'replace', 12345);
        const second = notesFromSetCall(1).map((node) => node.pitch);

        // Same seed -> identical sequence (regression: used to be Math.random).
        expect(first).toEqual(second);
    });

    it("merge mode keeps the clip's existing notes; replace mode overwrites them", () => {
        const existing = [{ id: 'orig', pitch: 48, startBeat: 0, duration: 4, velocity: 90 }];

        mocks.midiStoreValue.value = { notesByClipId: { c1: existing } };
        arpeggiate('c1', 'up', 8, 1, 100, 'replace');
        const afterReplace = notesFromSetCall(0);
        expect(afterReplace.some((node) => node.id === 'orig')).toBe(false);

        mocks.midiStoreValue.value = { notesByClipId: { c1: existing } };
        arpeggiate('c1', 'up', 8, 1, 100, 'merge');
        const afterMerge = notesFromSetCall(1);
        expect(afterMerge.some((node) => node.id === 'orig')).toBe(true);
        expect(afterMerge.length).toBeGreaterThan(existing.length);
    });
});
