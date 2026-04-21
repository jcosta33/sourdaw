import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { legatoNotes } from '../legatoNotes';

function note(id: string, pitch: number, startBeat: number, duration: number) {
    return {
        id,
        pitch,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('legatoNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    note('a', 60, 0, 0.5),
                    note('b', 60, 2, 0.5), // gap of 1.5
                    note('c', 64, 4, 0.5), // different pitch
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should extend note to next note on same pitch', () => {
        legatoNotes('clip1', ['a']);
        const notes = midiStore.value?.notesByClipId.clip1;
        const noteA = notes?.find((n) => n.id === 'a');
        expect(noteA?.duration).toBe(2);
    });

    it('should fallback to next note on any pitch within selection', () => {
        // Remove b, or select a and c.
        legatoNotes('clip1', ['a', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        const _noteA = notes?.find((n) => n.id === 'a');
        // It finds 'b' even if not in selection if b is on same pitch.
        // Wait, the logic finds ANY note in the clip for same-pitch, but fallback only selection.
        // Let's test fallback.
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 0.5), note('c', 64, 4, 0.5)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        legatoNotes('clip1', ['a', 'c']);
        const noteA2 = midiStore.value?.notesByClipId.clip1?.find((n) => n.id === 'a');
        expect(noteA2?.duration).toBe(4);
    });

    it('should not change last note', () => {
        legatoNotes('clip1', ['c']);
        const noteC = midiStore.value?.notesByClipId.clip1?.find((n) => n.id === 'c');
        expect(noteC?.duration).toBe(0.5);
    });
});
