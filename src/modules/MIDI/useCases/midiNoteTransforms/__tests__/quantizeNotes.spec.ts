import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { quantizeNotes } from '../quantizeNotes';

const note = (id: string, startBeat: number) => ({
    id,
    pitch: 60,
    startBeat,
    duration: 0.25,
    velocity: 100,
});

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
        expect(midiStore.value?.notesByClipId.clip1?.map((n) => n.startBeat)).toEqual([0, 0.5]);
    });

    it('should not mutate when the clip or store is missing', () => {
        quantizeNotes('missing', 0.25);
        midiStore.set(null);
        quantizeNotes('clip1', 0.25);
        expect(midiStore.value).toBeNull();
    });
});
