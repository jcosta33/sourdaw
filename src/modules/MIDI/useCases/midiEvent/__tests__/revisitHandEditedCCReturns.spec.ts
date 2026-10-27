import { describe, it, expect, beforeEach } from 'vitest';

import { SEQUENCER_TICK_BEATS } from '../../../models/SequencerTick';
import { midiStore } from '../../../stores/midiStore';
import { createStoredBendRangeReader } from '../../midiClipData/createStoredBendRangeReader';
import { prepareMidiClipGlueState } from '../../midiClipData/prepareMidiClipGlueState';
import { prepareMidiClipSplit } from '../../midiClipData/prepareMidiClipSplit';
import { addMidiCC } from '../addMidiCC';
import { moveMidiCC } from '../moveMidiCC';
import { removeMidiCC } from '../removeMidiCC';
import { restoreMidiCCPoints } from '../restoreMidiCCPoints';
import { revisitHandEditedCCReturns } from '../revisitHandEditedCCReturns';

import type { MidiCC } from '../../../models/MidiNote';

describe('revisitHandEditedCCReturns', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    const tick = SEQUENCER_TICK_BEATS;
    // A split right half whose origin declares RPN 0 at the source's range, and whose return
    // family restores the state at the cut: RPN 0 at range 2, then the NRPN 1 the keyboard
    // had selected when the take was recorded.
    const origin: readonly MidiCC[] = [
        { id: 'origin-0', controller: 101, value: 0, beat: 0, channel: 0 },
        { id: 'origin-1', controller: 100, value: 0, beat: 0, channel: 0 },
    ];
    const cutReturn = (
        [
            [101, 0],
            [100, 0],
            [6, 2],
            [38, 0],
            [99, 1],
            [98, 1],
        ] as const
    ).map(([controller, value], index) => ({
        id: `cc-split:right:rpn-after-carried-${index}`,
        controller,
        value,
        beat: tick,
        channel: 0,
    }));

    function seed(rows: readonly MidiCC[]): void {
        midiStore.set({ notesByClipId: {}, ccByClipId: { c1: [...rows] }, pitchBendByClipId: {} });
    }

    function rangeAfter(): number {
        const rows = midiStore.value?.ccByClipId.c1 ?? [];
        return createStoredBendRangeReader(rows)(0, 1);
    }

    it.each([
        { producer: 'split', cutRange: 2 },
        { producer: 'split', cutRange: 5 },
        { producer: 'glue', cutRange: 2 },
        { producer: 'glue', cutRange: 5 },
    ])(
        'retains the committed range after replacing a selector on a $producer head originally at $cutRange',
        ({ producer, cutRange }) => {
            const rangeRows = (key: string, beat: number, range: number): MidiCC[] =>
                (
                    [
                        [101, 0],
                        [100, 0],
                        [6, range],
                        [38, 0],
                    ] as const
                ).map(([controller, value], index) => ({
                    id: `${key}-${index}`,
                    controller,
                    value,
                    beat,
                    channel: 0,
                }));
            midiStore.set({
                notesByClipId: {},
                ccByClipId: { source: [...rangeRows('held', 0.1, 12), ...rangeRows('cut', 1.3, cutRange)] },
                pitchBendByClipId: { source: [{ id: 'held-bend', value: 8191, beat: 1.2, channel: 0 }] },
            });
            if (producer === 'split') {
                const plan = prepareMidiClipSplit({
                    sourceClipId: 'source',
                    rightClipId: 'c1',
                    splitBeat: 2,
                    splitNotes: true,
                });
                expect(plan).not.toBeNull();
                seed(plan!.nextRight.controlChanges.value);
            } else {
                const plan = prepareMidiClipGlueState({
                    sources: [
                        { clipId: 'source', visibleStartBeat: 2, visibleEndBeat: 4, beatOffset: -2 },
                        { clipId: 'neighbor', visibleStartBeat: 0, visibleEndBeat: 2, beatOffset: 2 },
                    ],
                    targetClipId: 'c1',
                });
                expect(plan).not.toBeNull();
                const target = plan!.next.clips.find(({ clipId }) => clipId === 'c1');
                expect(target).toBeDefined();
                seed(target!.data.controlChanges.value);
            }
            expect(rangeAfter()).toBe(cutRange);
            addMidiCC('c1', 99, 1, 0, 0);
            const selector = addMidiCC('c1', 100, 0, 0, 0);
            const coarse = addMidiCC('c1', 6, 7, 0, 0);
            expect(rangeAfter()).toBe(7);
            const currentCCsBefore = midiStore.value?.ccByClipId.c1 ?? [];
            const before = [...currentCCsBefore];
            const returns = before.filter(({ id }) => id.includes('rpn-after-carried'));

            // Replacement appends the selector after the coarse. That coarse now arrives under NRPN,
            // but a selector does not undo the range already committed into the standing returns.
            const replacement = addMidiCC('c1', 100, 0, 0, 0);
            const currentCCsAfter = midiStore.value?.ccByClipId.c1 ?? [];
            const committed = [...currentCCsAfter];
            expect(committed.findIndex(({ id }) => id === replacement.id)).toBeGreaterThan(
                committed.findIndex(({ id }) => id === coarse.id)
            );
            expect(committed.filter(({ id }) => id.includes('rpn-after-carried'))).toEqual(returns);
            expect(rangeAfter()).toBe(7);

            // Replay the captured point inverse with the existing public restoration primitive.
            removeMidiCC('c1', replacement.id);
            restoreMidiCCPoints('c1', [selector], before);
            expect(midiStore.value?.ccByClipId.c1).toEqual(before);
            expect(rangeAfter()).toBe(7);
            addMidiCC('c1', 100, 0, 0, 0, replacement.id);
            expect(midiStore.value?.ccByClipId.c1).toEqual(committed);
            expect(rangeAfter()).toBe(7);
        }
    );

    it('carries the hand-set coarse range in the returns the add rewrites, and reading later bends gives it', () => {
        seed([...origin, ...cutReturn]);

        addMidiCC('c1', 6, 7, 0, 0);

        expect(rangeAfter()).toBe(7);
    });

    it('deleting the hand point keeps the returns carrying the last hand-set range, never the orphaned fine half', () => {
        // Once the add rewrote the family, the range at the cut is no longer recoverable from the
        // rows: the delete's revisit re-declares what the family restores, which is the last
        // hand-set range — the orphaned fine half must never govern.
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);

        removeMidiCC('c1', point.id);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        expect(rangeAfter()).toBe(7);
    });

    it('undoing the delete puts the hand-set range back', () => {
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);
        removeMidiCC('c1', point.id);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        restoreMidiCCPoints('c1', [point]);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        expect(rangeAfter()).toBe(7);
    });

    it('dragging the hand point value to 9 sends later bends to 9, not the rewritten return stale 7', () => {
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);

        moveMidiCC('c1', point.id, point.beat, 9);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        expect(rangeAfter()).toBe(9);
    });

    it('undoing the drag puts the hand-set value back', () => {
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);
        moveMidiCC('c1', point.id, point.beat, 9);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        moveMidiCC('c1', point.id, point.beat, 7);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        expect(rangeAfter()).toBe(7);
    });

    it('a Data Entry LSB added beside the hand point completes the fractional range the returns carry', () => {
        seed([...origin, ...cutReturn]);
        addMidiCC('c1', 6, 7, 0, 0);

        addMidiCC('c1', 38, 50, 0, 0);

        expect(rangeAfter()).toBe(7.5);
    });

    it('moving a Data Entry LSB point onto a head whose only coarse is the writer row leaves the family untouched', () => {
        // A lone LSB sets no coarse range, and the writer's declaration is the one row the returns
        // deliberately override, so the fine-only revisit must be a no-op here and the family must
        // keep restoring the cut state.
        const lsbPoint: MidiCC = { id: 'cc-hand-lsb', controller: 38, value: 50, beat: 1, channel: 0 };
        seed([...origin, ...cutReturn, lsbPoint]);
        const before = midiStore.value?.ccByClipId.c1 ?? [];

        moveMidiCC('c1', lsbPoint.id, 0, 50);
        revisitHandEditedCCReturns('c1', { channel: 0, beat: 0 }, { editedController: 38 });

        // The move itself legitimately repositions the point; the family must be untouched.
        const after = midiStore.value?.ccByClipId.c1 ?? [];
        expect(
            after.filter(({ id }) => id.includes('rpn-after-carried')).map((row) => [row.id, row.controller, row.value])
        ).toEqual(
            before
                .filter(({ id }) => id.includes('rpn-after-carried'))
                .map((row) => [row.id, row.controller, row.value])
        );
        expect(rangeAfter()).toBe(2);
    });

    it('moving a writer carried row at the head reconciles nothing', () => {
        // The writer's carried coarse is the row the returns exist to override; dragging it is not
        // a hand edit of the range, and the family must keep restoring the cut state.
        const writerCarried: MidiCC = {
            id: 'cc-split:right:rpn-carried-2',
            controller: 6,
            value: 12,
            beat: 0,
            channel: 0,
        };
        seed([...origin, writerCarried, ...cutReturn]);
        const before = midiStore.value?.ccByClipId.c1 ?? [];

        moveMidiCC('c1', writerCarried.id, 0, 9);
        revisitHandEditedCCReturns(
            'c1',
            { channel: 0, beat: 0 },
            {
                editedController: 6,
                editedRowId: writerCarried.id,
            }
        );

        // The move itself legitimately repositions the writer row; the family must be untouched.
        const after = midiStore.value?.ccByClipId.c1 ?? [];
        expect(
            after.filter(({ id }) => id.includes('rpn-after-carried')).map((row) => [row.id, row.controller, row.value])
        ).toEqual(
            before
                .filter(({ id }) => id.includes('rpn-after-carried'))
                .map((row) => [row.id, row.controller, row.value])
        );
        expect(rangeAfter()).toBe(2);
    });

    it('a lone Data Entry LSB beside a family row that replays first leaves the family untouched on a move', () => {
        // Row order where the family replays before the same-beat fine half: without the
        // fine-only gate the reconcile would rewrite the family to the orphaned fine half's
        // range; with it the family keeps restoring the cut state.
        const familyFirst: MidiCC = {
            id: 'cc-split:right:rpn-after-carried-0',
            controller: 6,
            value: 2,
            beat: 0,
            channel: 0,
        };
        const loneFine: MidiCC = { id: 'cc-hand-lsb', controller: 38, value: 50, beat: 0, channel: 0 };
        seed([familyFirst, loneFine, ...cutReturn.filter((row) => row.id !== familyFirst.id)]);

        moveMidiCC('c1', loneFine.id, 0, 60);
        revisitHandEditedCCReturns('c1', { channel: 0, beat: 0 }, { editedController: 38, editedRowId: loneFine.id });

        const family = (midiStore.value?.ccByClipId.c1 ?? []).filter(({ id }) => id.includes('rpn-after-carried'));
        expect(family.map((row) => [row.controller, row.value])).toEqual([
            [6, 2],
            [100, 0],
            [6, 2],
            [38, 0],
            [99, 1],
            [98, 1],
        ]);
    });

    it('moving a writer coarse that replays after the family reconciles nothing in that order too', () => {
        // Row order where the family replays before the same-beat writer coarse: the writer row
        // is what the returns override, so the writer-row guard must no-op the reconcile however
        // the beats tie.
        const familyFirst: MidiCC = {
            id: 'cc-split:right:rpn-after-carried-0',
            controller: 6,
            value: 2,
            beat: 0,
            channel: 0,
        };
        const writerCoarse: MidiCC = {
            id: 'cc-split:right:rpn-carried-2',
            controller: 6,
            value: 12,
            beat: 0,
            channel: 0,
        };
        seed([familyFirst, writerCoarse, ...cutReturn.filter((row) => row.id !== familyFirst.id)]);

        moveMidiCC('c1', writerCoarse.id, 0, 9);
        revisitHandEditedCCReturns(
            'c1',
            { channel: 0, beat: 0 },
            {
                editedController: 6,
                editedRowId: writerCoarse.id,
            }
        );

        const family = (midiStore.value?.ccByClipId.c1 ?? []).filter(({ id }) => id.includes('rpn-after-carried'));
        expect(family.map((row) => [row.controller, row.value])).toEqual([
            [6, 2],
            [100, 0],
            [6, 2],
            [38, 0],
            [99, 1],
            [98, 1],
        ]);
    });

    it('a real split origin carrying data bytes never leaves later bends at the orphaned fine half after a delete', () => {
        // A carved right half's origin declares the cut state with its data bytes (the writer's
        // `:rpn-` rows); the add replaces the origin's coarse at its key, so the delete revisits a
        // head whose visible rows hold only the orphaned fine half. The range at the cut is no
        // longer recoverable once the add rewrote the family; the delete must still not leave the
        // orphaned half governing, and the returns keep carrying the last hand-set range.
        const originWithBytes: readonly MidiCC[] = [
            ...origin,
            { id: 'origin-2', controller: 6, value: 2, beat: 0, channel: 0 },
            { id: 'origin-3', controller: 38, value: 0, beat: 0, channel: 0 },
        ];
        seed([...originWithBytes, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);

        removeMidiCC('c1', point.id);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        expect(rangeAfter()).toBe(7);
        expect(rangeAfter()).not.toBe(0);
    });

    it('moving the hand point away from the head keeps the returns carrying the last hand-set range, never the orphaned fine half', () => {
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);

        moveMidiCC('c1', point.id, 1, 7);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: 1 });

        expect(rangeAfter()).toBe(7);
    });
});
