import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { removeMidiCC } from '../removeMidiCC';

describe('removeMidiCC', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {
                c1: [
                    { id: 'a', controller: 1, value: 0, beat: 0, channel: 0 },
                    { id: 'b', controller: 2, value: 64, beat: 1, channel: 0 },
                ],
            },
            pitchBendByClipId: {},
        });
    });

    it('should remove only the CC with the given id', () => {
        removeMidiCC('c1', 'a');
        expect(midiStore.value?.ccByClipId.c1?.map((context) => context.id)).toEqual(['b']);
    });

    it('should not mutate when the clip or store is missing', () => {
        removeMidiCC('missing', 'a');
        midiStore.set(null);
        removeMidiCC('c1', 'a');
        expect(midiStore.value).toBeNull();
    });
});
