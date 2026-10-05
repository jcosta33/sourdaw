import { describe, it, expect, beforeEach } from 'vitest';

import { midiStore } from '../../../stores/midiStore';
import { restoreMidiCCPoints } from '../restoreMidiCCPoints';

describe('restoreMidiCCPoints', () => {
    beforeEach(() => {
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('should insert captured rows missing by id and never delete the rows already present', () => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {
                c1: [
                    { id: 'clicked', controller: 1, value: 99, beat: 1, channel: 0 },
                    { id: 'peer', controller: 11, value: 10, beat: 2, channel: 0 },
                ],
            },
            pitchBendByClipId: {},
        });
        const preClick = [
            { id: 'a', controller: 1, value: 40, beat: 1, channel: 0 },
            { id: 'peer', controller: 11, value: 10, beat: 2, channel: 0 },
        ];

        restoreMidiCCPoints('c1', preClick);

        // 'a' is back; the rows the gesture did not touch survive exactly once —
        // the wholesale write this replaces deleted 'clicked' outright.
        expect(midiStore.value?.ccByClipId.c1).toEqual([
            { id: 'clicked', controller: 1, value: 99, beat: 1, channel: 0 },
            { id: 'peer', controller: 11, value: 10, beat: 2, channel: 0 },
            { id: 'a', controller: 1, value: 40, beat: 1, channel: 0 },
        ]);
    });

    it('should not duplicate a captured row whose id is already present', () => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: { c1: [{ id: 'a', controller: 1, value: 50, beat: 1, channel: 0 }] },
            pitchBendByClipId: {},
        });

        restoreMidiCCPoints('c1', [{ id: 'a', controller: 1, value: 40, beat: 1, channel: 0 }]);

        // The live row wins; the stale captured copy is skipped.
        expect(midiStore.value?.ccByClipId.c1).toEqual([{ id: 'a', controller: 1, value: 50, beat: 1, channel: 0 }]);
    });

    it('should restore two rows sharing one key without a key dedupe', () => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: { c1: [] },
            pitchBendByClipId: {},
        });
        const captured = [
            { id: 'a', controller: 1, value: 40, beat: 1, channel: 0 },
            { id: 'b', controller: 1, value: 60, beat: 1, channel: 0 },
        ];

        restoreMidiCCPoints('c1', captured);

        // Both points share the (beat, channel, controller) key and both land.
        expect(midiStore.value?.ccByClipId.c1).toEqual(captured);
    });

    it('should copy into a fresh array and leave other clips untouched', () => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {
                c1: [{ id: 'live', controller: 1, value: 70, beat: 0, channel: 0 }],
                c2: [{ id: 'z', controller: 2, value: 1, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {},
        });
        const points = [{ id: 'a', controller: 1, value: 40, beat: 1, channel: 0 }];

        restoreMidiCCPoints('c1', points);

        const stored = midiStore.value?.ccByClipId.c1;
        expect(stored).not.toBe(points);
        expect(stored).toEqual([
            { id: 'live', controller: 1, value: 70, beat: 0, channel: 0 },
            { id: 'a', controller: 1, value: 40, beat: 1, channel: 0 },
        ]);
        expect(midiStore.value?.ccByClipId.c2).toEqual([{ id: 'z', controller: 2, value: 1, beat: 0, channel: 0 }]);
    });

    it('should not mutate when the store is missing', () => {
        midiStore.set(null);

        restoreMidiCCPoints('c1', [{ id: 'a', controller: 1, value: 40, beat: 1, channel: 0 }]);

        expect(midiStore.value).toBeNull();
    });
});
