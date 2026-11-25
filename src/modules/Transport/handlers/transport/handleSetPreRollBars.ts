import { createHandler } from '#/utils/createHandler';

import { setPreRollBars } from '../../useCases/transportControls/setPreRollBars';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { clampTransportBars } from './clampTransportBars';
import { projectBarsThroughPriorBatchActions } from './projectCountInAndPreRollThroughPriorBatchActions';

export const handleSetPreRollBars = createHandler<'setPreRollBars'>({
    // Only a restore guarded by the bar count it expects can be replayed after divergence.
    canReapplyAfterDivergence: (alpha) => alpha.payload.expectedBars !== undefined,
    validate: () => getTransportState() !== null,
    validationRefusalReason: () => (getTransportState() === null ? 'Transport state is not available' : null),
    execute: (alpha) => setPreRollBars(alpha.payload.bars, alpha.payload.expectedBars),
    isNoop: (alpha) => getTransportState()?.preRollBars === clampTransportBars(alpha.payload.bars),
    describe: (alpha, context) => {
        const live = getTransportState()?.preRollBars;
        const bars = clampTransportBars(alpha.payload.bars);
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
