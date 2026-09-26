import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { quantizeNotes } from '../quantizeNotes';

function note(id: string, startBeat: number) {
    return {
        id,
        pitch: 60,
        startBeat,
        duration: 0.25,
        velocity: 100,
    };
}

describe('quantizeNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 0.11), note('b', 0.47)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should snap start beats to the grid', () => {
        quantizeNotes('clip1', 0.25);
        expect(midiStore.value?.notesByClipId.clip1?.map((node) => node.startBeat)).toEqual([0, 0.5]);
    });

    it('should snap only selected notes to the grid when noteIds is provided', () => {
        quantizeNotes('clip1', 0.25, 1, 0, ['b']);
        expect(midiStore.value?.notesByClipId.clip1?.map((node) => node.startBeat)).toEqual([0.11, 0.5]);
    });

    it('should not mutate when the clip or store is missing', () => {
        quantizeNotes('missing', 0.25);
        midiStore.set(null);
        quantizeNotes('clip1', 0.25);
        expect(midiStore.value).toBeNull();
    });

    it('swings the eighth-note "and" on a 1/8 grid, but not the same beat position on a 1/16 grid', () => {
        // A note on beat 0.5 is step index 1 (odd, offbeat) on a 1/8 grid (gridSize
        // 0.5), so swing delays it there. On a 1/16 grid (gridSize 0.25) the same
        // beat is step index 2 (even) — the start of the second sixteenth-pair, not
        // its offbeat — so it must stay put; the swung sixteenths on that grid are
        // 0.25 and 0.75 instead (see quantizeBeatToGrid and quantizeMidiNotes specs).
        const swing = 1;

        midiStore.set({
            notesByClipId: { clip1: [note('half', 0.5)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNotes('clip1', 0.5, 1, swing); // 1/8 grid
        const eighthGridStart = midiStore.value?.notesByClipId.clip1?.[0]?.startBeat;

        midiStore.set({
            notesByClipId: { clip1: [note('half', 0.5)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNotes('clip1', 0.25, 1, swing); // 1/16 grid
        const sixteenthGridStart = midiStore.value?.notesByClipId.clip1?.[0]?.startBeat;

        expect(eighthGridStart).toBeGreaterThan(0.5);
        expect(sixteenthGridStart).toBe(0.5);
    });

    it('should not swing beat 1 on a 1/16 grid, where it lands on an even grid step', () => {
        midiStore.set({
            notesByClipId: { clip1: [note('beat', 1)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNotes('clip1', 0.25, 1, 1); // beat 1 -> step 4 on a 0.25 grid, an even step (no swing)
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.startBeat).toBe(1);
    });
});
