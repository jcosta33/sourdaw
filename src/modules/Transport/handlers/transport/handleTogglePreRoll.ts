import { createHandler } from '#/utils/createHandler';

import { setPreRollEnabled } from '../../useCases/transportControls/setPreRollEnabled';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { projectEnabledThroughPriorBatchActions } from './projectCountInAndPreRollThroughPriorBatchActions';

const NO_TRANSPORT_REASON = 'Transport state is not available';

export const handleTogglePreRoll = createHandler<'togglePreRoll'>({
    // Only a restore guarded by the state it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload?.expectedEnabled !== undefined,
    // Conflicts when `expectedEnabled` no longer matches the live pre-roll; proven by the `canReportConflict` registry honesty spec.
    canReportConflict: true,
    validate: () => getTransportState() !== null,
    validationRefusalReason: () => (getTransportState() === null ? NO_TRANSPORT_REASON : null),
    execute: (action) => {
        const state = getTransportState();
        if (!state) {
            return { status: 'no-write' };
        }
        return setPreRollEnabled({
            enabled: action.payload?.enabled ?? !state.preRollEnabled,
            expectedEnabled: action.payload?.expectedEnabled,
        });
    },
    // A bare toggle always changes the state; an explicit state changes nothing when it already holds.
    isNoop: (action) => {
        const state = getTransportState();
        if (!state) {
            return true;
        }
        const enabled = action.payload?.enabled;
        return enabled !== undefined && state.preRollEnabled === enabled;
    },
    describe: (action, context) => {
        const live = getTransportState()?.preRollEnabled;
        if (live === undefined) {
            return { label: 'Toggle pre-roll', inverseAction: null };
        }
        // Both legs name the state they expect, so a later edit conflicts instead of being overwritten.
        const previous = projectEnabledThroughPriorBatchActions('preRoll', live, context);
        const next = action.payload?.enabled ?? !previous;
        return {
            label: next ? 'Enable pre-roll' : 'Disable pre-roll',
            inverseAction: { type: 'togglePreRoll', payload: { enabled: previous, expectedEnabled: next } },
            redoAction: { type: 'togglePreRoll', payload: { enabled: next, expectedEnabled: previous } },
        };
    },
    undoable: true,
});
