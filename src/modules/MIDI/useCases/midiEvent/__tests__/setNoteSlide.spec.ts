import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { setNoteSlide } from '../setNoteSlide';

function note(id: string) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity: 100,
    };
}

describe('setNoteSlide', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1'), note('n2')],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should set slide on the matching note and clamp to 0–127', () => {
        setNoteSlide('c1', 'n1', -5);
        expect(midiStore.value?.notesByClipId.c1?.find((node) => node.id === 'n1')?.slide).toBe(0);
        setNoteSlide('c1', 'n1', 500);
        expect(midiStore.value?.notesByClipId.c1?.find((node) => node.id === 'n1')?.slide).toBe(127);
    });

    it('should not mutate when the clip or store is missing', () => {
        setNoteSlide('missing', 'n1', 10);
        midiStore.set(null);
        setNoteSlide('c1', 'n1', 10);
        expect(midiStore.value).toBeNull();
    });
});
