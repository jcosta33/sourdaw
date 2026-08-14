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
        const description = handleSetTimeSignature.describe(action);
        const inverseAction = description.inverseAction;

        expect(inverseAction).toEqual({
            type: 'setTimeSignature',
            payload: {
                denominator: 4,
                expectedDenominator: 8,
                expectedNumerator: 7,
                numerator: 4,
            },
        });
        expect(description.redoAction).toEqual({
            type: 'setTimeSignature',
            payload: {
                denominator: 8,
                expectedDenominator: 4,
                expectedNumerator: 4,
                numerator: 7,
            },
        });

        void handleSetTimeSignature.execute(action);
        expect([transport.numerator, transport.denominator]).toEqual([7, 8]);
        if (inverseAction?.type !== 'setTimeSignature') {
            throw new Error('Expected setTimeSignature to produce a matching inverse action');
        }
        void handleSetTimeSignature.execute(inverseAction);

        expect([transport.numerator, transport.denominator]).toEqual([4, 4]);
    });

    it('rejects a guarded inverse after a collaborator changes the time signature', () => {
        const action = { type: 'setTimeSignature' as const, payload: { numerator: 7, denominator: 8 } };
        const inverseAction = handleSetTimeSignature.describe(action).inverseAction;
        if (inverseAction?.type !== 'setTimeSignature') {
            throw new Error('Expected setTimeSignature to produce a matching inverse action');
        }
        void handleSetTimeSignature.execute(action);
        transport.numerator = 5;
        transport.denominator = 4;

        expect(handleSetTimeSignature.validate?.(inverseAction, { actionIndex: 0, actions: [inverseAction] })).toBe(
            false
        );
        expect(handleSetTimeSignature.execute(inverseAction)).toEqual({ status: 'conflict' });
        expect([transport.numerator, transport.denominator]).toEqual([5, 4]);
    });

    it('does not consume a guarded inverse when a collaborator already chose its replacement value', () => {
        const inverse = {
            type: 'setTimeSignature' as const,
            payload: {
                denominator: 4,
                expectedDenominator: 8,
                expectedNumerator: 7,
                numerator: 4,
            },
        };

        expect(handleSetTimeSignature.isNoop?.(inverse)).toBe(false);
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
