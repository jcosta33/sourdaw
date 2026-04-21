import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { moveMidiNote } from '../moveMidiNote';

function note(id: string) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity: 100,
    };
}

describe('moveMidiNote', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1'), note('n2')],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should update pitch and start beat for the matching note only', () => {
        moveMidiNote('c1', 'n1', 72, 4);
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n1')).toMatchObject({
            pitch: 72,
            startBeat: 4,
        });
        expect(midiStore.value?.notesByClipId.c1?.find((n) => n.id === 'n2')?.startBeat).toBe(0);
    });

    it('should not mutate when the clip or store is missing', () => {
        moveMidiNote('missing', 'n1', 60, 0);
        midiStore.set(null);
        moveMidiNote('c1', 'n1', 60, 0);
        expect(midiStore.value).toBeNull();
    });
});
