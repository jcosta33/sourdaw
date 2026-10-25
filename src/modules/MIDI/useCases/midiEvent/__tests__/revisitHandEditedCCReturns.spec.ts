import { describe, it, expect, beforeEach } from 'vitest';

import { SEQUENCER_TICK_BEATS } from '../../../models/SequencerTick';
import { createStoredBendRangeReader } from '../../midiClipData/createStoredBendRangeReader';
import { midiStore } from '../../../stores/midiStore';
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

    it('carries the hand-set coarse range in the returns the add rewrites, and reading later bends gives it', () => {
        seed([...origin, ...cutReturn]);

        addMidiCC('c1', 6, 7, 0, 0);

        expect(rangeAfter()).toBe(7);
    });

    it('deleting the hand point sends later bends back to the range at the cut', () => {
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);

        removeMidiCC('c1', point.id);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });

        expect(rangeAfter()).toBe(2);
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

    it('moving the hand point away from the head returns later bends to the range at the cut', () => {
        seed([...origin, ...cutReturn]);
        const point = addMidiCC('c1', 6, 7, 0, 0);

        moveMidiCC('c1', point.id, 1, 7);
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: point.beat });
        revisitHandEditedCCReturns('c1', { channel: point.channel, beat: 1 });

        expect(rangeAfter()).toBe(2);
    });
});
