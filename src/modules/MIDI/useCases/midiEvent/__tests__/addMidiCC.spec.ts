import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { addMidiCC } from '../addMidiCC';

describe('addMidiCC', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should append a CC event and return it', () => {
        const cc = addMidiCC('c1', 7, 100, 4, 1);
        expect(cc.controller).toBe(7);
        expect(cc.value).toBe(100);
        expect(cc.beat).toBe(4);
        expect(cc.channel).toBe(1);
        expect(midiStore.value?.ccByClipId.c1).toHaveLength(1);
        expect(midiStore.value?.ccByClipId.c1?.[0]).toEqual(cc);
    });

    it('should throw when the MIDI store is not initialized', () => {
        midiStore.set(null);
        expect(() => addMidiCC('c1', 1, 64, 0)).toThrow();
    });
});
