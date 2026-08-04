import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { batchAddMidiNotes } from '../batchAddMidiNotes';

describe('batchAddMidiNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should return an empty array without mutating when the input list is empty', () => {
        expect(batchAddMidiNotes('c1', [])).toEqual([]);
        expect(midiStore.value?.notesByClipId.c1).toBeUndefined();
    });

    it('should append clamped notes in a single store write', () => {
        const created = batchAddMidiNotes('c1', [
            { pitch: 200, startBeat: -1, duration: 0.01, velocity: 0 },
            { pitch: 60, startBeat: 0, duration: 0.25 },
        ]);
        expect(created).toHaveLength(2);
        expect(created[0]?.pitch).toBe(127);
        expect(created[0]?.startBeat).toBe(0);
        expect(created[0]?.duration).toBeGreaterThanOrEqual(0.0625);
        expect(created[0]?.velocity).toBe(1);
        expect(midiStore.value?.notesByClipId.c1).toHaveLength(2);
    });

    it('should preserve a command-owned note id', () => {
        const created = batchAddMidiNotes('c1', [
            { id: 'note-stable', pitch: 60, startBeat: 0, duration: 0.25, velocity: 96 },
        ]);

        expect(created[0]?.id).toBe('note-stable');
        expect(midiStore.value?.notesByClipId.c1?.[0]?.id).toBe('note-stable');
    });

    it('should throw when the MIDI store is not initialized', () => {
        midiStore.set(null);
        expect(() => batchAddMidiNotes('c1', [{ pitch: 60, startBeat: 0, duration: 0.25 }])).toThrow();
    });
});
