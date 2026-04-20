import { describe, it, expect, vi, beforeEach } from 'vitest';
import { arpeggiate } from '../arpeggiator';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {} } },
    midiStoreSet: vi.fn(),
}));

vi.mock('../../stores/midiStore', () => ({
    midiStore: {
        get value() { return mocks.midiStoreValue.value; },
        set: mocks.midiStoreSet,
    }
}));

describe('arpeggiate', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates an "up" pattern for a single chord', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { 
                c1: [
                    { pitch: 64, startBeat: 0, duration: 4, velocity: 100 },
                    { pitch: 60, startBeat: 0, duration: 4, velocity: 100 },
                    { pitch: 67, startBeat: 0, duration: 4, velocity: 100 },
                ] 
            }
        } as any;

        // Rate 8 -> step size 0.5. 4 beats / 0.5 = 8 notes.
        arpeggiate('c1', 'up', 8, 1, 100);

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const newNotes = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;
        expect(newNotes).toHaveLength(8);
        
        // Up pattern on C (60), E (64), G (67)
        expect(newNotes[0].pitch).toBe(60);
        expect(newNotes[1].pitch).toBe(64);
        expect(newNotes[2].pitch).toBe(67);
        expect(newNotes[3].pitch).toBe(60);
        
        expect(newNotes[0].startBeat).toBe(0);
        expect(newNotes[1].startBeat).toBe(0.5);
    });

    it('expands octaves', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ pitch: 60, startBeat: 0, duration: 1 }] }
        } as any;

        // Rate 4 -> step size 1. 1 beat / 1 = 1 note.
        // 2 octaves.
        arpeggiate('c1', 'up', 4, 2); 

        const newNotes = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;
        // The loop is beat < maxBeat. 0 < 1. Only 1 note.
        // Wait, maxBeat is start + duration. 0 + 1 = 1.
        expect(newNotes).toHaveLength(1);
        expect(newNotes[0].pitch).toBe(60);
        
        // If duration was longer:
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ pitch: 60, startBeat: 0, duration: 2 }] }
        } as any;
        arpeggiate('c1', 'up', 4, 2);
        const notes2 = mocks.midiStoreSet.mock.calls[1][0].notesByClipId.c1;
        expect(notes2).toHaveLength(2);
        expect(notes2[0].pitch).toBe(60);
        expect(notes2[1].pitch).toBe(72); // +1 octave
    });
});
