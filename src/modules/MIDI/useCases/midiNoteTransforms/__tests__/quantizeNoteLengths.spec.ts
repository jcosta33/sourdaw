import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { quantizeNoteLengths } from '../quantizeNoteLengths';

function note(id: string, duration: number) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration,
        velocity: 100,
    };
}

describe('quantizeNoteLengths', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 0.11), note('b', 0.4)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should snap to the nearest grid multiple and preserve sub-grid notes', () => {
        quantizeNoteLengths('clip1', 0.25);
        // 0.11 rounds to zero grid steps -> kept as-is (not inflated to 0.25);
        // 0.4 rounds to two grid steps -> 0.5.
        expect(midiStore.value?.notesByClipId.clip1?.map((node) => node.duration)).toEqual([0.11, 0.5]);
    });

    it('should not inflate a sub-grid note to a full grid step (1/64 on a 1/4 grid)', () => {
        midiStore.set({
            notesByClipId: { clip1: [note('tiny', 0.015625)] }, // 1/64 note
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNoteLengths('clip1', 0.25); // 1/4 grid
        // Previously forced to 0.25 (16x longer); now its short duration is preserved.
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.duration).toBe(0.015625);
    });

    it('should snap a note longer than half a grid step up to the nearest multiple', () => {
        midiStore.set({
            notesByClipId: { clip1: [note('x', 0.13)] }, // > half of 0.25
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNoteLengths('clip1', 0.25);
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.duration).toBe(0.25);
    });

    it('should preserve finite durations when given a subnormal grid', () => {
        quantizeNoteLengths('clip1', Number.MIN_VALUE);

        expect(midiStore.value?.notesByClipId.clip1?.map((node) => node.duration)).toEqual([0.11, 0.4]);
        expect(midiStore.value?.notesByClipId.clip1?.every((node) => Number.isFinite(node.duration))).toBe(true);
    });

    it('should not run when the clip is empty or missing', () => {
        quantizeNoteLengths('missing', 0.25);
        midiStore.set({
            notesByClipId: { empty: [] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        quantizeNoteLengths('empty', 0.25);
        expect(midiStore.value?.notesByClipId.empty).toEqual([]);
    });

    it('should not mutate when the store is null', () => {
        midiStore.set(null);
        quantizeNoteLengths('clip1', 0.25);
        expect(midiStore.value).toBeNull();
    });
});
