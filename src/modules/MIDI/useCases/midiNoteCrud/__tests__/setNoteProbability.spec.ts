import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { setNoteProbability } from '../setNoteProbability';

function note(id: string) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity: 100,
    };
}

describe('setNoteProbability', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1'), note('n2')],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should set probability on the matching note and clamp to 0–100', () => {
        setNoteProbability('c1', 'n1', 150);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n1')?.probability).toBe(100);
        setNoteProbability('c1', 'n1', -10);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n1')?.probability).toBe(0);
    });

    it('should not mutate when the clip or store is missing', () => {
        setNoteProbability('missing', 'n1', 50);
        midiStore.set(null);
        setNoteProbability('c1', 'n1', 50);
        expect(midiStore.value).toBeNull();
    });
});
