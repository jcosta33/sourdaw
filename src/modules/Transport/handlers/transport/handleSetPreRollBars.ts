import { createHandler } from '#/utils/createHandler';

import { setPreRollBars } from '../../useCases/transportControls/setPreRollBars';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { projectBarsThroughPriorBatchActions } from './projectCountInAndPreRollThroughPriorBatchActions';
import { isRequestableTransportBars, transportBarsRefusalReason } from './transportBarsRequest';

export const handleSetPreRollBars = createHandler<'setPreRollBars'>({
    // Only a restore guarded by the bar count it expects can be replayed after divergence.
    canReapplyAfterDivergence: (alpha) => alpha.payload.expectedBars !== undefined,
    // Conflicts when `expectedBars` no longer matches the live pre-roll; proven by the `canReportConflict` registry honesty spec.
    canReportConflict: true,
    validate: (alpha) => getTransportState() !== null && isRequestableTransportBars(alpha.payload.bars),
    validationRefusalReason: (alpha) => {
        if (getTransportState() === null) {
            return 'Transport state is not available';
        }
        return transportBarsRefusalReason(alpha.payload.bars);
    },
    // A written change reports nothing, as an unconditional write always has; only a refusal reports a status.
    execute: (alpha) => {
        const result = setPreRollBars(alpha.payload.bars, alpha.payload.expectedBars);
        return result.status === 'written' ? undefined : result;
    },
    isNoop: (alpha) => getTransportState()?.preRollBars === alpha.payload.bars,
    describe: (alpha, context) => {
        const live = getTransportState()?.preRollBars;
        const { bars } = alpha.payload;
        const label = `Set pre-roll to ${bars} bars`;
        if (live === undefined) {
            return { label, inverseAction: null, redoAction: { type: 'setPreRollBars', payload: { bars } } };
        }
        // Both legs name the bar count they expect, so a later edit conflicts instead of being overwritten.
        const previous = projectBarsThroughPriorBatchActions('preRoll', live, context);
        return {
            label,
            inverseAction: { type: 'setPreRollBars', payload: { bars: previous, expectedBars: bars } },
            redoAction: { type: 'setPreRollBars', payload: { bars, expectedBars: previous } },
        };
    },
    undoable: true,
});
