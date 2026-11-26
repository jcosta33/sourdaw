import { createHandler } from '#/utils/createHandler';

import { setCountInEnabled } from '../../useCases/transportControls/setCountInEnabled';
import { getTransportState } from '../../useCases/transportQueries/getTransportState';

import { projectEnabledThroughPriorBatchActions } from './projectCountInAndPreRollThroughPriorBatchActions';

const NO_TRANSPORT_REASON = 'Transport state is not available';

export const handleToggleCountIn = createHandler<'toggleCountIn'>({
    // Only a restore guarded by the state it expects can be replayed after divergence.
    canReapplyAfterDivergence: (action) => action.payload?.expectedEnabled !== undefined,
    // Conflicts when `expectedEnabled` no longer matches the live count-in; proven by the `canReportConflict` registry honesty spec.
    canReportConflict: true,
    validate: () => getTransportState() !== null,
    validationRefusalReason: () => (getTransportState() === null ? NO_TRANSPORT_REASON : null),
    execute: (action) => {
        const state = getTransportState();
        if (!state) {
            return { status: 'no-write' };
        }
        return setCountInEnabled({
            enabled: action.payload?.enabled ?? !state.countInEnabled,
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
        return enabled !== undefined && state.countInEnabled === enabled;
    },
    describe: (action, context) => {
        const live = getTransportState()?.countInEnabled;
        if (live === undefined) {
            return { label: 'Toggle count-in', inverseAction: null };
        }
        // Both legs name the state they expect, so a later edit conflicts instead of being overwritten.
        const previous = projectEnabledThroughPriorBatchActions('countIn', live, context);
        const next = action.payload?.enabled ?? !previous;
        return {
            label: next ? 'Enable count-in' : 'Disable count-in',
            inverseAction: { type: 'toggleCountIn', payload: { enabled: previous, expectedEnabled: next } },
            redoAction: { type: 'toggleCountIn', payload: { enabled: next, expectedEnabled: previous } },
        };
    },
    undoable: true,
});
