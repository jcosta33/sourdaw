import { describe, expect, it } from 'vitest';

import { createMidiChannelControllerState } from '../../models/MidiControllerState';
import { applyRegisteredParameterChange } from '../applyRegisteredParameterChange';
import { isRegisteredParameterController, reconcileRegisteredParameterMessages } from '../registeredParameterState';

type Message = { channel: number; controller: number; value: number };

const RPN_MSB = 101;
const RPN_LSB = 100;
const NRPN_MSB = 99;
const NRPN_LSB = 98;
const DATA_MSB = 6;
const DATA_LSB = 38;
const DATA_INCREMENT = 96;

function message(controller: number, value: number, channel = 0): Message {
    return { channel, controller, value };
}

function selectRpn(msb: number, lsb: number, channel = 0): Message[] {
    return [message(RPN_MSB, msb, channel), message(RPN_LSB, lsb, channel)];
}

function selectNrpn(msb: number, lsb: number, channel = 0): Message[] {
    return [message(NRPN_MSB, msb, channel), message(NRPN_LSB, lsb, channel)];
}

function dataEntry(msb: number, lsb: number, channel = 0): Message[] {
    return [message(DATA_MSB, msb, channel), message(DATA_LSB, lsb, channel)];
}

/** A range declared through RPN 0 and closed with the Null RPN, as a controller sends it. */
function declareRange(semitones: number, cents = 0, channel = 0): Message[] {
    return [...selectRpn(0, 0, channel), ...dataEntry(semitones, cents, channel), ...selectRpn(127, 127, channel)];
}

function replay(messages: readonly Message[], channel = 0) {
    const state = createMidiChannelControllerState();
    for (const row of messages.filter((candidate) => candidate.channel === channel)) {
        applyRegisteredParameterChange(state, row.controller, row.value);
    }
    return {
        bendRangeSemitones: state.bendRangeSemitones,
        selectedParameterKind: state.selectedParameterKind,
        selectedParameterMsb: state.selectedParameterMsb,
        selectedParameterLsb: state.selectedParameterLsb,
        dataEntryMsb: state.dataEntryMsb,
        dataEntryLsb: state.dataEntryLsb,
    };
}

function declaration(target: readonly Message[], current: readonly Message[] = []) {
    return reconcileRegisteredParameterMessages({ current, target });
}

describe('reconcileRegisteredParameterMessages', () => {
    it('declares nothing for a channel that never addressed a parameter', () => {
        expect(declaration([])).toEqual([]);
        expect(declaration([message(DATA_MSB, 12)])).toEqual([]);
    });

    it('declares the range a Null RPN closed, which the last value of each lane does not say', () => {
        expect(declaration(declareRange(12))).toEqual(declareRange(12));
    });

    it('declares a range still selected without selecting it again, so a Data Entry that follows lands on it', () => {
        const source = [...selectRpn(0, 0), ...dataEntry(12, 0)];

        expect(declaration(source)).toEqual(source);
    });

    it('declares the selection of RPN 0 and no range when a take only selected it', () => {
        expect(declaration(selectRpn(0, 0))).toEqual(selectRpn(0, 0));
    });

    it('selects RPN 0 again after the range when the source selected it again, which clears the data entry bytes', () => {
        const source = [...selectRpn(0, 0), ...dataEntry(12, 0), ...selectRpn(0, 0)];

        expect(declaration(source)).toEqual(source);
        // Replaying the declaration must leave a lone LSB where the source would have put it.
        const afterLsb = [...source, message(DATA_LSB, 50)];
        expect(replay([...declaration(source), message(DATA_LSB, 50)])).toEqual(replay(afterLsb));
    });

    it('declares a range an increment moved to the value it reached', () => {
        const source = [...selectRpn(0, 0), ...dataEntry(2, 0), message(DATA_INCREMENT, 0), message(DATA_INCREMENT, 0)];

        expect(declaration(source)).toEqual([...selectRpn(0, 0), ...dataEntry(4, 0)]);
        expect(replay(declaration(source))).toEqual(replay(source));
    });

    it('declares the cents of a range, rounded from the float they were read as', () => {
        // 12.29 - 12 is 0.2899999999999991 in a float: truncating it would declare 28 cents.
        expect(declaration(declareRange(12, 29))).toContainEqual(message(DATA_LSB, 29));
        expect(replay(declaration(declareRange(12, 29)))).toEqual(replay(declareRange(12, 29)));
    });

    it('declares a parameter another bank selected, with no data entry when none was written to it', () => {
        const source = [message(NRPN_MSB, 1), message(NRPN_LSB, 5)];

        expect(declaration(source)).toEqual(source);
    });

    it('keeps the parameter another bank selected, with the data entry written to it, after the range', () => {
        const source = [...declareRange(12), message(NRPN_MSB, 1), message(NRPN_LSB, 5), ...dataEntry(9, 3)];

        const declared = declaration(source);

        expect(replay(declared)).toEqual(replay(source));
        expect(declared).toEqual([
            ...selectRpn(0, 0),
            ...dataEntry(12, 0),
            message(NRPN_MSB, 1),
            message(NRPN_LSB, 5),
            ...dataEntry(9, 3),
        ]);
    });

    it('leaves the Null RPN selected after a range, so a Data Entry after it is not taken for the range', () => {
        const declared = declaration(declareRange(12));
        const afterEntry = [...declared, message(DATA_MSB, 24)];

        expect(replay(afterEntry).bendRangeSemitones).toBe(12);
    });

    it('declares each channel from its own messages and leaves a channel that declared nothing alone', () => {
        const source = [
            ...declareRange(12, 0, 0),
            ...selectRpn(0, 0, 1),
            ...dataEntry(24, 0, 1),
            message(DATA_MSB, 1, 2),
        ];

        const declared = declaration(source);

        expect(declared.filter((row) => row.channel === 0)).toEqual(declareRange(12, 0, 0));
        expect(declared.filter((row) => row.channel === 1)).toEqual([...selectRpn(0, 0, 1), ...dataEntry(24, 0, 1)]);
        expect(declared.some((row) => row.channel === 2)).toBe(false);
        for (const channel of [0, 1, 2]) {
            expect(replay(declared, channel)).toEqual(replay(source, channel));
        }
    });

    it.each([
        ['a range closed by the Null RPN', declareRange(12, 25)],
        ['a range left selected', [...selectRpn(0, 0), ...dataEntry(7, 0)]],
        [
            'a range written by its LSB alone after a reselect',
            [...declareRange(12), ...selectRpn(0, 0), message(DATA_LSB, 40)],
        ],
        ['an increment before any data entry', [...selectRpn(0, 0), message(DATA_INCREMENT, 0)]],
        [
            'an NRPN selected after a range',
            [...declareRange(12), message(NRPN_MSB, 3), message(NRPN_LSB, 9), ...dataEntry(5, 6)],
        ],
        [
            'a Data Entry byte past 127, which the range clamps and the byte keeps',
            [...selectRpn(0, 0), message(DATA_MSB, 200)],
        ],
        ['a Data Entry the Null RPN ignored', [...declareRange(12), message(DATA_MSB, 99)]],
        ['a lone MSB select of RPN 0 over a Null RPN', [...selectRpn(127, 127), message(RPN_MSB, 0)]],
    ])('replays to the state the source left, for %s', (_name, source) => {
        expect(replay(declaration(source))).toEqual(replay(source));
    });

    describe('for a channel the glued clip already holds a state on', () => {
        it('declares nothing when the channel is already in the state', () => {
            expect(declaration(declareRange(12), declareRange(12))).toEqual([]);
        });

        it('brings a channel that declared no range back to the default range and the Null NRPN', () => {
            const reconciled = declaration([], declareRange(12));

            expect(reconciled).toEqual([...selectRpn(0, 0), ...dataEntry(2, 0), ...selectNrpn(127, 127)]);
        });

        it.each([
            ['an RPN left selected', selectRpn(0, 1)],
            ['a range closed by the Null RPN', declareRange(12)],
            ['an NRPN left selected', [message(NRPN_MSB, 1), message(NRPN_LSB, 5)]],
        ])('leaves a channel that selected %s answering what follows as a channel that never did', (_name, held) => {
            const reconciled = declaration([], held);

            // The range a fresh channel reads as undefined is the default two semitones everywhere it is read.
            const bendRangeAfter = (tail: readonly Message[]) =>
                replay([...held, ...reconciled, ...tail]).bendRangeSemitones ?? 2;
            const freshBendRangeAfter = (tail: readonly Message[]) => replay(tail).bendRangeSemitones ?? 2;
            for (const tail of [
                [message(RPN_MSB, 0), message(DATA_INCREMENT, 0)],
                [message(RPN_MSB, 0), message(97, 0)],
                [message(RPN_MSB, 0), message(DATA_MSB, 5)],
                [message(RPN_LSB, 0), message(DATA_MSB, 5)],
                [message(DATA_MSB, 5)],
                [message(DATA_INCREMENT, 0)],
                [message(RPN_MSB, 3), message(RPN_LSB, 0), message(DATA_MSB, 5)],
            ]) {
                expect(bendRangeAfter(tail)).toBe(freshBendRangeAfter(tail));
            }
        });

        it('brings a channel that selected a parameter back to no selection', () => {
            const reconciled = declaration([], selectRpn(0, 0));

            expect(replay([...selectRpn(0, 0), ...reconciled]).selectedParameterMsb).toBe(127);
            expect(
                replay([...selectRpn(0, 0), ...reconciled, message(DATA_MSB, 9)]).bendRangeSemitones
            ).toBeUndefined();
        });

        it('replaces a different declared range', () => {
            const reconciled = declaration(declareRange(24), declareRange(12));

            expect(replay([...declareRange(12), ...reconciled]).bendRangeSemitones).toBe(24);
        });
    });
});

describe('isRegisteredParameterController', () => {
    it.each([RPN_MSB, RPN_LSB, NRPN_MSB, NRPN_LSB, DATA_MSB, DATA_LSB, DATA_INCREMENT, 97])(
        'takes controller %i for a message to the state machine',
        (controller) => {
            expect(isRegisteredParameterController(controller)).toBe(true);
        }
    );

    it.each([0, 1, 7, 10, 64, 102, 120])('takes controller %i for a lane value', (controller) => {
        expect(isRegisteredParameterController(controller)).toBe(false);
    });
});
