import { createHandler } from '#/utils/createHandler';

import { setCountInBars } from '../../useCases/transportControls/setCountInBars';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { clampTransportBars } from './clampTransportBars';
import { projectBarsThroughPriorBatchActions } from './projectCountInAndPreRollThroughPriorBatchActions';

export const handleSetCountInBars = createHandler<'setCountInBars'>({
    // Only a restore guarded by the bar count it expects can be replayed after divergence.
    canReapplyAfterDivergence: (alpha) => alpha.payload.expectedBars !== undefined,
    // Conflicts when `expectedBars` no longer matches the live count-in; proven by the `canReportConflict` registry honesty spec.
    canReportConflict: true,
    validate: () => getTransportState() !== null,
    validationRefusalReason: () => (getTransportState() === null ? 'Transport state is not available' : null),
    // A written change reports nothing, as an unconditional write always has; only a refusal reports a status.
    execute: (alpha) => {
        const result = setCountInBars(alpha.payload.bars, alpha.payload.expectedBars);
        return result.status === 'written' ? undefined : result;
    },
    isNoop: (alpha) => getTransportState()?.countInBars === clampTransportBars(alpha.payload.bars),
    describe: (alpha, context) => {
        const live = getTransportState()?.countInBars;
        const bars = clampTransportBars(alpha.payload.bars);
        const label = `Set count-in to ${bars} bars`;
        if (live === undefined) {
            return { label, inverseAction: null, redoAction: { type: 'setCountInBars', payload: { bars } } };
        }
        // Both legs name the bar count they expect, so a later edit conflicts instead of being overwritten.
        const previous = projectBarsThroughPriorBatchActions('countIn', live, context);
        return {
            label,
            inverseAction: { type: 'setCountInBars', payload: { bars: previous, expectedBars: bars } },
            redoAction: { type: 'setCountInBars', payload: { bars, expectedBars: previous } },
        };
    },
    undoable: true,
});
