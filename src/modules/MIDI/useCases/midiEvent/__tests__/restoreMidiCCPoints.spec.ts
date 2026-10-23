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

    describe('with the list as it stood before the gesture', () => {
        const row = (id: string, beat: number) => ({ id, controller: 6, value: 1, beat, channel: 0 });
        const previous = [row('a', 0), row('displaced', 1), row('b', 1), row('c', 2)];

        function seed(rows: readonly ReturnType<typeof row>[]) {
            midiStore.set({ notesByClipId: {}, ccByClipId: { c1: [...rows] }, pitchBendByClipId: {} });
        }

        function idsAfter() {
            return midiStore.value?.ccByClipId.c1?.map(({ id }) => id);
        }

        it('puts a displaced row back ahead of the first surviving row that followed it', () => {
            seed([row('a', 0), row('b', 1), row('c', 2)]);

            restoreMidiCCPoints('c1', [row('displaced', 1)], previous);

            expect(idsAfter()).toEqual(['a', 'displaced', 'b', 'c']);
        });

        it('skips a follower that is gone and uses the next surviving one', () => {
            seed([row('a', 0), row('c', 2)]);

            restoreMidiCCPoints('c1', [row('displaced', 1), row('b', 1)], previous);

            expect(idsAfter()).toEqual(['a', 'displaced', 'b', 'c']);
        });

        it('appends a displaced row none of whose followers survive', () => {
            seed([row('a', 0)]);

            restoreMidiCCPoints('c1', [row('b', 1), row('c', 2)], previous);

            expect(idsAfter()).toEqual(['a', 'b', 'c']);
        });

        it('appends a row the previous list does not hold', () => {
            seed([row('a', 0), row('c', 2)]);

            restoreMidiCCPoints('c1', [row('unknown', 1)], previous);

            expect(idsAfter()).toEqual(['a', 'c', 'unknown']);
        });
    });

    it('should not mutate when the store is missing', () => {
        midiStore.set(null);

        restoreMidiCCPoints('c1', [{ id: 'a', controller: 1, value: 40, beat: 1, channel: 0 }]);

        expect(midiStore.value).toBeNull();
    });
});
