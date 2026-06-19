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

    it('should not mutate when the clip or store is missing', () => {
        quantizeNotes('missing', 0.25);
        midiStore.set(null);
        quantizeNotes('clip1', 0.25);
        expect(midiStore.value).toBeNull();
    });

    it('should treat the half-beat "and" as the swung offbeat regardless of grid size', () => {
        // A note on beat 0.5 (the eighth-note "and") must be delayed by swing on any
        // grid. Previously the offbeat was the parity of the raw grid-line index, so
        // beat 0.5 was step 1 (offbeat) on a 1/2 grid but step 2 (onbeat) on a 1/4
        // grid, inverting the swing direction with the grid resolution.
        const swing = 1;

        midiStore.set({
            notesByClipId: { clip1: [note('half', 0.5)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNotes('clip1', 0.5, 1, swing); // 1/2 grid
        const halfGridStart = midiStore.value?.notesByClipId.clip1?.[0]?.startBeat;

        midiStore.set({
            notesByClipId: { clip1: [note('half', 0.5)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNotes('clip1', 0.25, 1, swing); // 1/4 grid
        const quarterGridStart = midiStore.value?.notesByClipId.clip1?.[0]?.startBeat;

        // Both grids must delay beat 0.5 (offbeat) — neither leaves it un-swung at 0.5.
        expect(halfGridStart).toBeGreaterThan(0.5);
        expect(quarterGridStart).toBeGreaterThan(0.5);
    });

    it('should not swing the on-beat (whole-beat position) on any grid', () => {
        midiStore.set({
            notesByClipId: { clip1: [note('beat', 1)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNotes('clip1', 0.25, 1, 1); // beat 1 -> step 4, swing unit 2 (even => on-beat)
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.startBeat).toBe(1);
    });
});
