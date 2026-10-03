import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { restoreMidiCCPoints } from '../restoreMidiCCPoints';

describe('restoreMidiCCPoints', () => {
    beforeEach(() => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('should replace the clip array with the given points without a key dedupe', () => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: { c1: [{ id: 'clicked', controller: 1, value: 99, beat: 1, channel: 0 }] },
            pitchBendByClipId: {},
        });
        const preClick = [
            { id: 'a', controller: 1, value: 40, beat: 1, channel: 0 },
            { id: 'b', controller: 1, value: 60, beat: 1, channel: 0 },
        ];

        restoreMidiCCPoints('c1', preClick);

        // Both points share the (beat, channel, controller) key and both survive.
        expect(midiStore.value?.ccByClipId.c1).toEqual(preClick);
    });

    it('should copy the given array and leave other clips untouched', () => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: { c1: [], c2: [{ id: 'z', controller: 2, value: 1, beat: 0, channel: 0 }] },
            pitchBendByClipId: {},
        });
        const points = [{ id: 'a', controller: 1, value: 40, beat: 1, channel: 0 }];

        restoreMidiCCPoints('c1', points);

        const stored = midiStore.value?.ccByClipId.c1;
        expect(stored).not.toBe(points);
        expect(stored).toEqual(points);
        expect(midiStore.value?.ccByClipId.c2).toEqual([{ id: 'z', controller: 2, value: 1, beat: 0, channel: 0 }]);
    });

    it('should not mutate when the store is missing', () => {
        midiStore.set(null);

        restoreMidiCCPoints('c1', [{ id: 'a', controller: 1, value: 40, beat: 1, channel: 0 }]);

        expect(midiStore.value).toBeNull();
    });
});
