import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores/midiStore';

import { setNotePressure } from '../setNotePressure';

const note = (id: string) => ({
    id,
    pitch: 60,
    startBeat: 0,
    duration: 0.25,
    velocity: 100,
});

describe('setNotePressure', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1'), note('n2')],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should set pressure on the matching note and clamp to 0–127', () => {
        setNotePressure('c1', 'n1', 200);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n1')?.pressure).toBe(127);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n2')?.pressure).toBeUndefined();
    });

    it('should not mutate when the clip or store is missing', () => {
        setNotePressure('missing', 'n1', 64);
        midiStore.set(null);
        setNotePressure('c1', 'n1', 64);
        expect(midiStore.value).toBeNull();
    });
});
