import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';

import { setNoteVelocity } from '../setNoteVelocity';

const note = (id: string, velocity: number) => ({
    id,
    pitch: 60,
    startBeat: 0,
    duration: 0.25,
    velocity,
});

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

    it('should set velocity on the matching note and clamp to 0–127', () => {
        setNoteVelocity('c1', 'n2', 300);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n2')?.velocity).toBe(127);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n1')?.velocity).toBe(80);
    });

    it('should not mutate when the clip or store is missing', () => {
        setNoteVelocity('missing', 'n1', 64);
        midiStore.set(null);
        setNoteVelocity('c1', 'n1', 64);
        expect(midiStore.value).toBeNull();
    });
});
