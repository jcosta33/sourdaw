import { createHandler } from '#/utils/createHandler';

import { readYeastGrooveAssignments } from '../useCases/readYeastGrooveAssignments';
import { removeYeastProcessor } from '../useCases/removeYeastProcessor';

import { findProcessor, isSameProcessorSnapshot, readYeastRackState } from './rackState';

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
        return processor !== undefined && isSameProcessorSnapshot(processor, action.payload.expectedProcessor);
    },
    execute: (action) => {
        const state = readYeastRackState();
        const processor = state ? findProcessor(state, action.payload.processorId) : undefined;
        if (!processor) {
            return { status: 'conflict' };
        }
        if (!isSameProcessorSnapshot(processor, action.payload.expectedProcessor)) {
            return { status: 'conflict' };
        }
        // Also deletes the processor's groove assignments in the MIDI store;
        // the addYeastProcessor restore leg re-binds the ones captured below.
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
        // describe() runs before the write, so these snapshots are the
        // processor and its groove assignments exactly as the restore leg
        // will re-insert / re-bind them.
        const grooveAssignments = processor ? readYeastGrooveAssignments(action.payload.processorId) : [];
        return {
            label: 'Remove Yeast processor',
            inverseAction:
                processor === undefined
                    ? null
                    : {
                          type: 'addYeastProcessor',
                          payload: {
                              processorId: action.payload.processorId,
                              type: processor.type,
                              name: processor.name,
                              restore: {
                                  processor,
                                  atIndex: action.payload.expectedIndex,
                                  grooveAssignments,
                              },
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
