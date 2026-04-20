import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { moveMidiCC } from '../moveMidiCC';

describe('moveMidiCC', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {
                c1: [{ id: 'cc-a', controller: 1, value: 10, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {},
        });
    });

    it('should update beat and value for the matching CC id', () => {
        moveMidiCC('c1', 'cc-a', 2, 200);
        const cc = midiStore.value?.ccByClipId.c1?.[0];
        expect(cc?.beat).toBe(2);
        expect(cc?.value).toBe(127);
    });

    it('should clamp beat to non-negative values', () => {
        moveMidiCC('c1', 'cc-a', -5, 10);
        expect(midiStore.value?.ccByClipId.c1?.[0]?.beat).toBe(0);
    });

    it('should not mutate when the clip or store is missing', () => {
        moveMidiCC('missing', 'cc-a', 1, 1);
        midiStore.set(null);
        moveMidiCC('c1', 'cc-a', 1, 1);
        expect(midiStore.value).toBeNull();
    });
});
