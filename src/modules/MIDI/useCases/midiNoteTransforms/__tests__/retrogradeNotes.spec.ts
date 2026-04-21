import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { retrogradeNotes } from '../retrogradeNotes';

function note(id: string, startBeat: number, duration: number) {
    return {
        id,
        pitch: 60,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('retrogradeNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 0, 0.25), note('b', 0.5, 0.25)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should reverse note order along the timeline', () => {
        retrogradeNotes('clip1');
        const starts = midiStore.value?.notesByClipId.clip1?.map((n) => n.startBeat);
        expect(starts).toEqual([0.5, 0]);
    });

    it('should do nothing when fewer than two notes exist', () => {
        midiStore.set({
            notesByClipId: { clip1: [note('only', 0, 0.25)] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        retrogradeNotes('clip1');
        expect(midiStore.value?.notesByClipId.clip1?.[0]?.startBeat).toBe(0);
    });

    it('should not mutate when the clip or store is missing', () => {
        retrogradeNotes('missing');
        midiStore.set(null);
        retrogradeNotes('clip1');
        expect(midiStore.value).toBeNull();
    });
});
