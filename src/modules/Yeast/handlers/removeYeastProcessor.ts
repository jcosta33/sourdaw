import { createHandler } from '#/utils/createHandler';

import { removeYeastProcessor } from '../useCases/removeYeastProcessor';
import { findProcessor, isSameSnapshot, readYeastRackState } from './rackState';

export const handleRemoveYeastProcessor = createHandler<'removeYeastProcessor'>({
    // Conflicts when the live processor no longer matches `expectedProcessor`
    // — a peer edit inside that processor between snapshot and undo refuses
    // rather than silently dropping the edit. Per-key only: a peer edit to any
    // OTHER processor never blocks the undo (#2111). Proven by the
    // `canReportConflict` registry honesty spec; undo step-over (#2881) relies
    // on it.
    canReportConflict: true,
    validate: (action) => {
        const state = readYeastRackState();
        const processor = state ? findProcessor(state, action.payload.processorId) : undefined;
        return processor !== undefined && isSameSnapshot(processor, action.payload.expectedProcessor);
    },
    execute: (action) => {
        const state = readYeastRackState();
        const processor = state ? findProcessor(state, action.payload.processorId) : undefined;
        if (!processor) {
            return { status: 'conflict' };
        }
        if (!isSameSnapshot(processor, action.payload.expectedProcessor)) {
            return { status: 'conflict' };
        }
        // Also deletes the processor's groove assignments in the MIDI store;
        // the addYeastProcessor restore leg does not resurrect them — the
        // accepted gap recorded on the contract's removeYeastProcessor note.
        removeYeastProcessor(action.payload.processorId);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const state = readYeastRackState();
        return state ? findProcessor(state, action.payload.processorId) === undefined : false;
    },
    describe: (action) => {
        const state = readYeastRackState();
        const processor = state ? findProcessor(state, action.payload.processorId) : undefined;
        return {
            label: 'Remove Yeast processor',
            // describe() runs before the write, so this snapshot is the
            // processor exactly as the restore leg will re-insert it.
            inverseAction:
                processor === undefined
                    ? null
                    : {
                          type: 'addYeastProcessor',
                          payload: {
                              processorId: action.payload.processorId,
                              type: processor.type,
                              name: processor.name,
                              restore: { processor, atIndex: action.payload.expectedIndex },
                          },
                      },
            redoAction: {
                type: 'removeYeastProcessor',
                payload: {
                    processorId: action.payload.processorId,
                    expectedProcessor: action.payload.expectedProcessor,
                    expectedIndex: action.payload.expectedIndex,
                },
            },
        };
    },
    undoable: true,
});
