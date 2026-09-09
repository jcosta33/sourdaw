import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { reorderYeastProcessor } from '../useCases/reorderYeastProcessor';

import { findLiveProcessor, moveProcessorId, processorOrder, readYeastRackState } from './rackState';

function isSameOrder(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** The rack's id sequence as the batch's preceding reorder actions leave it.
 *  An undo batch replays inverses sequentially, so a guard must read the
 *  projected sequence, not the live pre-batch one. */
function plannedOrder(liveOrder: readonly string[], context: HandlerValidationContext): readonly string[] {
    let order = liveOrder;
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type === 'reorderYeastProcessor') {
            order = moveProcessorId(order, action.payload.processorId, action.payload.toIndex);
        }
    }
    return order;
}

export const handleReorderYeastProcessor = createHandler<'reorderYeastProcessor'>({
    // Conflicts when the rack's processor-id SEQUENCE no longer matches
    // `expectedOrder`, or the processor vanished. Sequence-only: a peer editing
    // a parameter anywhere on the rack never blocks the undo (#2111). Proven by
    // the `canReportConflict` registry honesty spec; undo step-over (#2881)
    // relies on it.
    canReportConflict: true,
    validate: (action, context) => {
        const state = readYeastRackState();
        if (!state) {
            return false;
        }
        return isSameOrder(plannedOrder(processorOrder(state), context), action.payload.expectedOrder);
    },
    execute: (action) => {
        const state = readYeastRackState();
        if (!state) {
            return { status: 'conflict' };
        }
        const order = processorOrder(state);
        if (!isSameOrder(order, action.payload.expectedOrder)) {
            return { status: 'conflict' };
        }
        const fromIndex = order.indexOf(action.payload.processorId);
        if (fromIndex < 0 || action.payload.toIndex < 0 || action.payload.toIndex >= order.length) {
            return { status: 'conflict' };
        }
        if (fromIndex === action.payload.toIndex) {
            return { status: 'no-write' };
        }
        reorderYeastProcessor(fromIndex, action.payload.toIndex);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (!processor) {
            return false;
        }
        const state = readYeastRackState();
        if (!state) {
            return false;
        }
        return (
            state.processors.findIndex((candidate) => candidate.id === action.payload.processorId) ===
            action.payload.toIndex
        );
    },
    describe: (action) => {
        const state = readYeastRackState();
        const currentOrder = state ? processorOrder(state) : [];
        const fromIndex = currentOrder.indexOf(action.payload.processorId);
        const movedOrder = moveProcessorId(currentOrder, action.payload.processorId, action.payload.toIndex);
        return {
            label: 'Reorder Yeast processor',
            // Self-inverse: moving back is guarded on the post-move sequence,
            // which is exactly what this move produces.
            inverseAction:
                fromIndex < 0 || fromIndex === action.payload.toIndex
                    ? null
                    : {
                          type: 'reorderYeastProcessor',
                          payload: {
                              processorId: action.payload.processorId,
                              toIndex: fromIndex,
                              expectedOrder: movedOrder,
                          },
                      },
            redoAction: {
                type: 'reorderYeastProcessor',
                payload: {
                    processorId: action.payload.processorId,
                    toIndex: action.payload.toIndex,
                    expectedOrder: currentOrder,
                },
            },
        };
    },
    undoable: true,
});
