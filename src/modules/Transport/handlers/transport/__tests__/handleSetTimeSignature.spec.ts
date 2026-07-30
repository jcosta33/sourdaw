import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSetTimeSignature } from '../handleSetTimeSignature';

const transport = vi.hoisted(() => ({
    numerator: 4,
    denominator: 4,
}));

vi.mock('../../../useCases/setTimeSignature', () => ({
    setTimeSignature: vi.fn((numerator: number, denominator: number) => {
        transport.numerator = numerator;
        transport.denominator = denominator;
    }),
}));

vi.mock('../../../useCases/transportQueries/getTransportState', () => ({
    getTransportState: vi.fn(() => ({
        timeSignatureNumerator: transport.numerator,
        timeSignatureDenominator: transport.denominator,
    })),
}));

describe('handleSetTimeSignature', () => {
    beforeEach(() => {
        transport.numerator = 4;
        transport.denominator = 4;
    });

    it('captures an inverse action that restores the previous time signature', () => {
        const action = { type: 'setTimeSignature' as const, payload: { numerator: 7, denominator: 8 } };
        const inverseAction = handleSetTimeSignature.describe(action).inverseAction;

        void handleSetTimeSignature.execute(action);
        expect([transport.numerator, transport.denominator]).toEqual([7, 8]);
        if (inverseAction?.type !== 'setTimeSignature') {
            throw new Error('Expected setTimeSignature to produce a matching inverse action');
        }
        void handleSetTimeSignature.execute(inverseAction);

        expect([transport.numerator, transport.denominator]).toEqual([4, 4]);
    });

    it('recognizes a request that already matches the current time signature', () => {
        expect(
            handleSetTimeSignature.isNoop?.({
                type: 'setTimeSignature',
                payload: { numerator: 4, denominator: 4 },
            })
        ).toBe(true);
        expect(
            handleSetTimeSignature.isNoop?.({
                type: 'setTimeSignature',
                payload: { numerator: 7, denominator: 8 },
            })
        ).toBe(false);
    });
});
