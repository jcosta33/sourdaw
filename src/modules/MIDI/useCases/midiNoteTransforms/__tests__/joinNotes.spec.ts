import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { joinNotes } from '../joinNotes';

function note(id: string, pitch: number, startBeat: number, duration: number) {
    return {
        id,
        pitch,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('joinNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    note('a', 60, 0, 1),
                    note('b', 60, 1, 1),
                    note('c', 60, 3, 1), // gap
                    note('d', 64, 0, 1), // different pitch
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should merge adjacent same-pitch selected notes', () => {
        joinNotes('clip1', ['a', 'b']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(3);
        const joined = notes?.find((node) => node.startBeat === 0 && node.pitch === 60);
        expect(joined?.duration).toBe(2);
        expect(notes?.find((node) => node.id === 'c')).toBeDefined();
        expect(notes?.find((node) => node.id === 'd')).toBeDefined();
    });

    it('should not merge non-adjacent notes', () => {
        joinNotes('clip1', ['a', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(4);
    });

    it('should not merge notes with different pitches', () => {
        joinNotes('clip1', ['a', 'd']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(4);
    });

    it('should merge multiple adjacent notes into one', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 1), note('b', 60, 1, 1), note('c', 60, 2, 1)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(1);
        expect(notes?.[0]?.duration).toBe(3);
    });

    it('should still merge notes left with sub-grid jitter after humanize/quantize', () => {
        // After humanize or quantize(strength<1) the end of 'a' no longer lands exactly
        // on the start of 'b'; a residual gap of 0.02 beats far exceeds the old 0.001
        // tolerance yet is musically adjacent on a 1/4 grid (tolerance = gridSize/8).
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 0.98), note('b', 60, 1, 1)], // 0.02-beat gap
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b'], 0.25); // 1/4 grid -> tolerance 0.03125
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(1);
        // Merged note spans from a.start (0) to b.end (1 + 1 = 2).
        expect(notes?.[0]?.duration).toBe(2);
    });

    it('should not merge across a gap larger than the grid tolerance', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 0.5), note('b', 60, 1, 1)], // 0.5-beat gap
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b'], 0.25); // tolerance 0.03125 << 0.5 gap
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(2);
    });
});
