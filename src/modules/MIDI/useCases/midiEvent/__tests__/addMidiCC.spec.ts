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

        type Row = typeof splitReturn;

        /** The selection messages the carried rows left on the head, ahead of the returns. */
        function selection(selects: readonly (readonly [controller: number, value: number])[]): Row[] {
            return selects.map(([controller, value], index) => ({
                id: `select-${index}`,
                controller,
                value,
                beat: 0,
                channel: 0,
            }));
        }

        const RPN_0 = selection([
            [101, 0],
            [100, 0],
        ]);

        function seed(rows: readonly Row[], selected: readonly Row[] = RPN_0) {
            midiStore.set({ notesByClipId: {}, ccByClipId: { c1: [...selected, ...rows] }, pitchBendByClipId: {} });
        }

        /** The ids stored, the selection rows left out. */
        function idsAfter() {
            return midiStore.value?.ccByClipId.c1?.map(({ id }) => id).filter((id) => !id.startsWith('select-'));
        }

        it('replaces the return one tick after the beat it lands on', () => {
            seed([splitReturn]);

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toEqual([cc.id]);
        });

        it('replaces a glue return on the beat of the window start it lands on, and only that one', () => {
            seed([splitReturn, glueReturn]);

            const cc = addMidiCC('c1', 6, 7, 4, 0);

            expect(idsAfter()).toEqual([splitReturn.id, cc.id]);
        });

        it.each([
            { name: 'Data Increment', controller: 96 },
            { name: 'Data Decrement', controller: 97 },
        ])('replaces the return for a $name, which steps the range', ({ controller }) => {
            seed([splitReturn]);

            const cc = addMidiCC('c1', controller, 0, 0, 0);

            expect(idsAfter()).toEqual([cc.id]);
        });

        it('replaces a return an earlier row of the clip pulled ahead of the tick', () => {
            seed([{ ...splitReturn, beat: tick / 2 }]);

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toEqual([cc.id]);
        });

        it.each([
            { name: 'an RPN MSB select', controller: 101, value: 127 },
            { name: 'an RPN LSB select', controller: 100, value: 0 },
            { name: 'an NRPN MSB select', controller: 99, value: 1 },
            { name: 'an NRPN LSB select', controller: 98, value: 1 },
            { name: 'a Null RPN half', controller: 100, value: 127 },
            { name: 'a Data Entry LSB', controller: 38, value: 0 },
        ])('keeps the return for $name, which sets no range', ({ controller, value }) => {
            seed([splitReturn]);

            const cc = addMidiCC('c1', controller, value, 0, 0);

            expect(idsAfter()).toEqual([splitReturn.id, cc.id]);
        });

        it.each([
            { name: 'on another channel', row: { ...splitReturn, channel: 1 } },
            { name: 'two ticks after the beat it lands on', row: { ...splitReturn, beat: 2 * tick } },
            { name: 'a beat after the beat it lands on', row: { ...splitReturn, beat: 1 } },
            { name: 'before the beat it lands on', row: { ...splitReturn, beat: -tick } },
            { name: 'that is an ordinary row, not a return', row: { ...splitReturn, id: 'cc-split:right:5' } },
            { name: 'whose id only resembles a return', row: { ...splitReturn, id: 'rpn-after-carried-0' } },
        ])('keeps a row $name', ({ row }) => {
            seed([row]);

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toEqual([row.id, cc.id]);
        });

        it.each([
            {
                name: 'a Null RPN, as a keyboard leaves it after a data entry',
                selected: [
                    [101, 127],
                    [100, 127],
                ],
            },
            {
                name: 'an NRPN',
                selected: [
                    [99, 1],
                    [98, 1],
                ],
            },
            {
                name: 'RPN 0 and then a Null RPN',
                selected: [
                    [101, 0],
                    [100, 0],
                    [101, 127],
                    [100, 127],
                ],
            },
            { name: 'nothing', selected: [] },
        ] as const)(
            'keeps the return for a Data Entry the state machine ignores, with $name selected where it lands',
            ({ selected }) => {
                seed([splitReturn], selection(selected));

                const cc = addMidiCC('c1', 6, 7, 0, 0);

                expect(idsAfter()).toEqual([splitReturn.id, cc.id]);
            }
        );

        it('keeps the return for a Data Entry when RPN 0 is selected only after it', () => {
            seed(
                [
                    splitReturn,
                    { id: 'select-late-0', controller: 101, value: 0, beat: 1, channel: 0 },
                    { id: 'select-late-1', controller: 100, value: 0, beat: 1, channel: 0 },
                ],
                []
            );

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toContain(splitReturn.id);
            expect(idsAfter()).toContain(cc.id);
        });

        it('replaces the return for a Data Entry when the selection was made by rows on other channels too', () => {
            seed([splitReturn, ...selection([[99, 1]]).map((row) => ({ ...row, id: 'other', channel: 1 }))]);

            const cc = addMidiCC('c1', 6, 7, 0, 0);

            expect(idsAfter()).toEqual(['other', cc.id]);
        });

        it.each([
            { name: 'half a beat', head: 0.5 },
            { name: 'eight beats', head: 8 },
        ])('replaces a return on a head $name in, where the tick falls a rounding step past the sum', ({ head }) => {
            const returnRow = { ...splitReturn, beat: head + tick };
            expect(returnRow.beat - head).toBeGreaterThan(tick);
            seed([returnRow]);

            const cc = addMidiCC('c1', 6, 7, head, 0);

            expect(idsAfter()).toEqual([cc.id]);
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
