import { describe, it, expect, beforeEach } from 'vitest';

import { SEQUENCER_TICK_BEATS } from '../../../models/SequencerTick';
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

    it('should replace an existing CC at the same (beat, channel, controller)', () => {
        addMidiCC('c1', 7, 100, 4, 1);
        const updated = addMidiCC('c1', 7, 30, 4, 1);

        const events = midiStore.value?.ccByClipId.c1;
        expect(events).toHaveLength(1);
        expect(events?.[0]).toEqual(updated);
        expect(events?.[0]?.value).toBe(30);
    });

    describe('a registered-parameter point set where a split or glue wrote a return', () => {
        const tick = SEQUENCER_TICK_BEATS;
        const splitReturn = {
            id: 'cc-split:right:rpn-after-carried-0',
            controller: 6,
            value: 2,
            beat: tick,
            channel: 0,
        };
        const glueReturn = {
            id: 'cc-glue:target:1:rpn-after-carried-3',
            controller: 100,
            value: 0,
            beat: 4 + tick,
            channel: 0,
        };

        function seed(rows: readonly (typeof splitReturn)[]) {
            midiStore.set({ notesByClipId: {}, ccByClipId: { c1: [...rows] }, pitchBendByClipId: {} });
        }

        function idsAfter() {
            return midiStore.value?.ccByClipId.c1?.map(({ id }) => id);
        }

        it('replaces the return one tick after the beat it lands on', () => {
            seed([splitReturn]);

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toEqual([cc.id]);
        });

        it('replaces a glue return on the beat of the window start it lands on, whichever registered controller sets it', () => {
            seed([splitReturn, glueReturn]);

            const cc = addMidiCC('c1', 101, 0, 4, 0);

            expect(idsAfter()).toEqual([splitReturn.id, cc.id]);
        });

        it('replaces a return an earlier row of the clip pulled ahead of the tick', () => {
            seed([{ ...splitReturn, beat: tick / 2 }]);

            const cc = addMidiCC('c1', 38, 0, 0, 0);

            expect(idsAfter()).toEqual([cc.id]);
        });

        it.each([
            { name: 'on another channel', row: { ...splitReturn, channel: 1 } },
            { name: 'a beat after the beat it lands on', row: { ...splitReturn, beat: 1 } },
            { name: 'before the beat it lands on', row: { ...splitReturn, beat: -tick } },
            { name: 'that is an ordinary row, not a return', row: { ...splitReturn, id: 'cc-split:right:5' } },
            { name: 'whose id only resembles a return', row: { ...splitReturn, id: 'rpn-after-carried-0' } },
        ])('keeps a row $name', ({ row }) => {
            seed([row]);

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toEqual([row.id, cc.id]);
        });

        it('keeps the return when the point set is not a registered-parameter controller', () => {
            seed([splitReturn]);

            const cc = addMidiCC('c1', 7, 100, 0, 0);

            expect(idsAfter()).toEqual([splitReturn.id, cc.id]);
        });
    });

    it('should keep distinct CC points that differ in beat, channel, or controller', () => {
        addMidiCC('c1', 7, 100, 4, 1);
        addMidiCC('c1', 7, 100, 8, 1); // different beat
        addMidiCC('c1', 7, 100, 4, 2); // different channel
        addMidiCC('c1', 10, 100, 4, 1); // different controller

        expect(midiStore.value?.ccByClipId.c1).toHaveLength(4);
    });
});
