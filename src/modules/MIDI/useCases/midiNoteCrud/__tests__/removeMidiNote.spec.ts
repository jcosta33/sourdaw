import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { removeMidiNote } from '../removeMidiNote';

function note(id: string) {
    return {
        id,
        pitch: 60,
        startBeat: 0,
        duration: 0.25,
        velocity: 100,
    };
}

describe('removeMidiNote', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                c1: [note('n1'), note('n2')],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should remove only the note with the given id', () => {
        removeMidiNote('c1', 'n1');
        expect(midiStore.value?.notesByClipId.c1?.map((node) => node.id)).toEqual(['n2']);
    });

    it('should not mutate when the clip or store is missing', () => {
        removeMidiNote('missing', 'n1');
        midiStore.set(null);
        removeMidiNote('c1', 'n1');
        expect(midiStore.value).toBeNull();
    });
});
