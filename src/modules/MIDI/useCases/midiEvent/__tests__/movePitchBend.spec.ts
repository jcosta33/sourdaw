import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { movePitchBend } from '../movePitchBend';

describe('movePitchBend', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {
                c1: [{ id: 'pb-a', value: 0, beat: 0, channel: 0 }],
            },
        });
    });

    it('should update beat and clamp value to 14-bit pitch bend range', () => {
        movePitchBend('c1', 'pb-a', 4, 9000);
        const pb = midiStore.value?.pitchBendByClipId.c1?.[0];
        expect(pb?.beat).toBe(4);
        expect(pb?.value).toBe(8191);
    });

    it('should clamp negative values to -8192', () => {
        movePitchBend('c1', 'pb-a', 0, -10000);
        expect(midiStore.value?.pitchBendByClipId.c1?.[0]?.value).toBe(-8192);
    });

    it('should not mutate when the clip or store is missing', () => {
        movePitchBend('missing', 'pb-a', 1, 0);
        midiStore.set(null);
        movePitchBend('c1', 'pb-a', 1, 0);
        expect(midiStore.value).toBeNull();
    });
});
