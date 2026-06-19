import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { setNoteVelocity } from '../setNoteVelocity';

function note(id: string, velocity: number) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity,
    };
}

describe('setNoteVelocity', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1', 80), note('n2', 40)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should set velocity on the matching note and clamp to 1–127', () => {
        setNoteVelocity('c1', 'n2', 300);
        expect(midiStore.value?.notesByClipId.c1?.find((node) => node.id === 'n2')?.velocity).toBe(127);
        expect(midiStore.value?.notesByClipId.c1?.find((node) => node.id === 'n1')?.velocity).toBe(80);
    });

    it('should floor velocity at 1, never producing a silent (0) note', () => {
        setNoteVelocity('c1', 'n1', 0);
        expect(midiStore.value?.notesByClipId.c1?.find((node) => node.id === 'n1')?.velocity).toBe(1);

        setNoteVelocity('c1', 'n2', -50);
        expect(midiStore.value?.notesByClipId.c1?.find((node) => node.id === 'n2')?.velocity).toBe(1);
    });

    it('should not mutate when the clip or store is missing', () => {
        setNoteVelocity('missing', 'n1', 64);
        midiStore.set(null);
        setNoteVelocity('c1', 'n1', 64);
        expect(midiStore.value).toBeNull();
    });
});
