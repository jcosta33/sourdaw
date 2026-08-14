import { createHandler } from '#/utils/createHandler';

import { setTimeSignature } from '../../useCases/setTimeSignature';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetTimeSignature = createHandler<'setTimeSignature'>({
    canReapplyAfterDivergence: (action) =>
        action.payload.expectedNumerator !== undefined && action.payload.expectedDenominator !== undefined,
    validate: (action) => {
        const state = getTransportState();
        return (
            action.payload.expectedNumerator === undefined ||
            action.payload.expectedDenominator === undefined ||
            (state?.timeSignatureNumerator === action.payload.expectedNumerator &&
                state.timeSignatureDenominator === action.payload.expectedDenominator)
        );
    },
    execute: (action) => {
        const state = getTransportState();
        if (
            action.payload.expectedNumerator !== undefined &&
            action.payload.expectedDenominator !== undefined &&
            (state?.timeSignatureNumerator !== action.payload.expectedNumerator ||
                state.timeSignatureDenominator !== action.payload.expectedDenominator)
        ) {
            return { status: 'conflict' };
        }
        setTimeSignature(action.payload.numerator, action.payload.denominator);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const state = getTransportState();
        return (
            state?.timeSignatureNumerator === action.payload.numerator &&
            state.timeSignatureDenominator === action.payload.denominator &&
            (action.payload.expectedNumerator === undefined ||
                action.payload.expectedDenominator === undefined ||
                (state.timeSignatureNumerator === action.payload.expectedNumerator &&
                    state.timeSignatureDenominator === action.payload.expectedDenominator))
        );
    },
    describe: (action) => {
        const state = getTransportState();
        return {
            label: `Set time signature ${action.payload.numerator}/${action.payload.denominator}`,
            inverseAction: state
                ? {
                      type: 'setTimeSignature',
                      payload: {
                          numerator: state.timeSignatureNumerator,
                          denominator: state.timeSignatureDenominator,
                          expectedNumerator: action.payload.numerator,
                          expectedDenominator: action.payload.denominator,
                      },
                  }
                : null,
            redoAction: state
                ? {
                      type: 'setTimeSignature',
                      payload: {
                          numerator: action.payload.numerator,
                          denominator: action.payload.denominator,
                          expectedNumerator: state.timeSignatureNumerator,
                          expectedDenominator: state.timeSignatureDenominator,
                      },
                  }
                : undefined,
        };
    },
    undoable: true,
});
