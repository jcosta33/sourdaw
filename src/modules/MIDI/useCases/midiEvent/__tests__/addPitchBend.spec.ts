import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';

import { addPitchBend } from '../addPitchBend';

describe('addPitchBend', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should append a pitch bend event and return it', () => {
        const pb = addPitchBend('c1', 2048, 2, 3);
        expect(pb.value).toBe(2048);
        expect(pb.beat).toBe(2);
        expect(pb.channel).toBe(3);
        expect(midiStore.value?.pitchBendByClipId.c1).toHaveLength(1);
        expect(midiStore.value?.pitchBendByClipId.c1?.[0]).toEqual(pb);
    });

    it('should throw when the MIDI store is not initialized', () => {
        midiStore.set(null);
        expect(() => addPitchBend('c1', 0, 0)).toThrow();
    });
});
