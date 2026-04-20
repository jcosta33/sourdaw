import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { transposeNotes } from '../transposeNotes';

const note = (id: string, pitch: number) => ({
    id,
    pitch,
    startBeat: 0,
    duration: 0.25,
    velocity: 100,
});

describe('transposeNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60), note('b', 64)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should shift every note by semitones and clamp to 0–127', () => {
        transposeNotes('clip1', 12);
        expect(midiStore.value?.notesByClipId.clip1?.map((n) => n.pitch)).toEqual([72, 76]);
        transposeNotes('clip1', 100);
        expect(midiStore.value?.notesByClipId.clip1?.every((n) => n.pitch <= 127)).toBe(true);
    });

    it('should not mutate when the clip or store is missing', () => {
        transposeNotes('missing', 5);
        transposeNotes('clip1', 0);
        midiStore.set(null);
        transposeNotes('clip1', 5);
        expect(midiStore.value).toBeNull();
    });
});
