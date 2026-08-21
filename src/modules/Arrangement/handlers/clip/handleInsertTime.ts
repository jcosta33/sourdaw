import { createHandler } from '#/utils/createHandler';
import { type TimeOperationRestorePlanSnapshot } from '#/utils/handlerContract';

import { insertTime } from '../../useCases/timeOperations/insertTime';
import { reverseRestorePlan } from '../../useCases/timeOperations/reverseRestorePlan';

type RestoreTimeOperationStateAction = {
    type: 'restoreTimeOperationState';
    payload: { plan: TimeOperationRestorePlanSnapshot };
};

type PendingInsertTimeDescription = {
    label: string;
    inverseAction: RestoreTimeOperationStateAction | null;
    redoAction: RestoreTimeOperationStateAction | undefined;
};

// Placeholder for the window between `describe()` and `execute()`: the real plan only
// exists once the operation has actually applied, and nothing reads this value before then.
const PLACEHOLDER_PLAN: TimeOperationRestorePlanSnapshot = { version: undefined };

// Keyed by action so concurrent inserts cannot cross. `execute()` mutates the very object
// `describe()` already returned to the caller, which is how `executeAppAction` — reading
// that object only after execution completes — ends up with the real plan.
const pendingDescriptions = new WeakMap<object, PendingInsertTimeDescription>();

/**
 * `reverseRestorePlan` stays `unknown` by design: the codec that owns the plan's concrete
 * shape is private to Arrangement's time-operation internals. This checks only the minimal
 * structural fact the neutral command contract requires before trusting the value as the
 * plan `restoreTimeOperationState` carries.
 */
function toRestorePlanSnapshot(plan: unknown): TimeOperationRestorePlanSnapshot {
    if (typeof plan !== 'object' || plan === null || !('version' in plan)) {
        throw new TypeError('Global time operation produced an invalid restore plan');
    }
    // The `'version' in plan` guard above narrows to exactly the snapshot shape, so no
    // assertion is needed here: the contract is proven, not asserted.
    return plan;
}

export const handleInsertTime = createHandler<'insertTime'>({
    execute: (action) => {
        const result = insertTime(action.payload.atBeat, action.payload.durationBeats);
        const pending = pendingDescriptions.get(action);
        if (result.status !== 'applied') {
            // Nothing moved: recording an undo entry here would let a user "undo" a
            // no-op, landing on state identical to what they started from.
            if (pending) {
                pending.inverseAction = null;
                pending.redoAction = undefined;
            }
            return { status: 'no-write' };
        }
        if (pending) {
            pending.inverseAction = {
                type: 'restoreTimeOperationState',
                payload: { plan: toRestorePlanSnapshot(result.inversePlan) },
            };
            pending.redoAction = {
                type: 'restoreTimeOperationState',
                // Redo replays the guarded restore of the state this run produced, never
                // the forward operation itself: an intervening edit could shift the wrong
                // material if `insertTime` were simply replayed at the same beat.
                payload: { plan: toRestorePlanSnapshot(reverseRestorePlan(result.inversePlan)) },
            };
        }
        return { status: 'written' };
    },
    describe: (action) => {
        const pending: PendingInsertTimeDescription = {
            label: 'Insert time',
            inverseAction: { type: 'restoreTimeOperationState', payload: { plan: PLACEHOLDER_PLAN } },
            redoAction: { type: 'restoreTimeOperationState', payload: { plan: PLACEHOLDER_PLAN } },
        };
        pendingDescriptions.set(action, pending);
        return pending;
    },
    undoable: true,
});
