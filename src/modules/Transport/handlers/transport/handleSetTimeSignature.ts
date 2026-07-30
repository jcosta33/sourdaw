import { createHandler } from '#/utils/createHandler';

import { setTimeSignature } from '../../useCases/setTimeSignature';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export const handleSetTimeSignature = createHandler<'setTimeSignature'>({
    execute: (action) => {
        setTimeSignature(action.payload.numerator, action.payload.denominator);
    },
    isNoop: (action) => {
        const state = getTransportState();
        return (
            state?.timeSignatureNumerator === action.payload.numerator &&
            state.timeSignatureDenominator === action.payload.denominator
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
                      },
                  }
                : null,
        };
    },
    undoable: true,
});
