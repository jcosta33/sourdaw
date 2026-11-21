import { describe, expect, it } from 'vitest';

import { getInternalUndoSessionReplayContracts } from '../getInternalUndoSessionReplayContracts';
import { validateTransportBarsSessionEntry } from '../validateTransportBarsSessionEntry';

const ACTION_TYPES = ['setCountInBars', 'setPreRollBars'] as const;

function barsAction(type: string, bars: unknown): { type: string; payload: { bars: unknown } } {
    return { type, payload: { bars } };
}

function entryOf(actionType: string, bars: { action: unknown; inverse: unknown; redo: unknown }) {
    return {
        action: barsAction(actionType, bars.action),
        inverseAction: barsAction(actionType, bars.inverse),
        redoAction: barsAction(actionType, bars.redo),
    };
}

describe.each(ACTION_TYPES)('%s session replay contract', (actionType) => {
    it('begins an entry as a forward action that validates the whole entry', () => {
        const contract = getInternalUndoSessionReplayContracts().find(
            (candidate) => candidate.actionType === actionType
        );
        expect(contract).toMatchObject({ role: 'forward', operationVersion: 1 });
        expect(contract?.validateArguments({ bars: 2 })).toBe(true);
        expect(
            contract?.validateEntry?.({
                action: { type: actionType, payload: { bars: 3 } },
                inverseAction: { type: actionType, payload: { bars: 2 } },
                redoAction: { type: actionType, payload: { bars: 3 } },
            })
        ).toBe(true);
        expect(
            contract?.validateEntry?.({
                action: { type: actionType, payload: { bars: 3 } },
                inverseAction: { type: actionType, payload: { bars: 9 } },
                redoAction: { type: actionType, payload: { bars: 3 } },
            })
        ).toBe(false);
    });

    it.each([
        { name: 'the lowest bars', bars: 1 },
        { name: 'the highest bars', bars: 8 },
        { name: 'bars in between', bars: 4 },
    ])('admits an entry with $name', ({ bars }) => {
        expect(
            validateTransportBarsSessionEntry(actionType, entryOf(actionType, { action: bars, inverse: 2, redo: bars }))
        ).toBe(true);
    });

    it.each([
        { name: 'zero', bars: 0 },
        { name: 'nine', bars: 9 },
        { name: 'a fraction', bars: 2.5 },
        { name: 'a string', bars: '2' },
        { name: 'not a number', bars: Number.NaN },
    ])('rejects an entry whose forward bars is $name', ({ bars }) => {
        expect(
            validateTransportBarsSessionEntry(actionType, entryOf(actionType, { action: bars, inverse: 2, redo: 2 }))
        ).toBe(false);
    });

    it.each([
        { name: 'inverse is zero', bars: { action: 2, inverse: 0, redo: 2 } },
        { name: 'inverse is nine', bars: { action: 2, inverse: 9, redo: 2 } },
        { name: 'redo is a fraction', bars: { action: 2, inverse: 2, redo: 2.5 } },
        { name: 'redo is a string', bars: { action: 2, inverse: 2, redo: '2' } },
    ])('rejects an entry whose $name', ({ bars }) => {
        expect(validateTransportBarsSessionEntry(actionType, entryOf(actionType, bars))).toBe(false);
    });

    it('rejects an entry whose inverse is a different action type', () => {
        const other = actionType === 'setCountInBars' ? 'setPreRollBars' : 'setCountInBars';
        const entry = {
            ...entryOf(actionType, { action: 2, inverse: 1, redo: 2 }),
            inverseAction: barsAction(other, 1),
        };
        expect(validateTransportBarsSessionEntry(actionType, entry)).toBe(false);
    });

    it('rejects an entry without a redo action', () => {
        const { redoAction: _redoAction, ...entry } = entryOf(actionType, { action: 2, inverse: 1, redo: 2 });
        expect(validateTransportBarsSessionEntry(actionType, entry)).toBe(false);
    });

    it('rejects an entry without an inverse action', () => {
        const { inverseAction: _inverseAction, ...entry } = entryOf(actionType, { action: 2, inverse: 1, redo: 2 });
        expect(validateTransportBarsSessionEntry(actionType, entry)).toBe(false);
    });
});
