import { batchStoreUpdates } from '#/infra/store/createStore';
import { createHandler } from '#/utils/createHandler';
import { type YeastProcessorSnapshot } from '#/utils/handlerContract';

import { type ProcessorType } from '../models/ProcessorCatalog';
import { addYeastProcessor } from '../useCases/addYeastProcessor';
import { commitYeastProjection } from '../useCases/commitYeastProjection';
import { restoreYeastGrooveAssignments } from '../useCases/restoreYeastGrooveAssignments';

import { findProcessor, isSameProcessorSnapshot, readYeastRackState } from './rackState';

type AddPayload = {
    processorId: string;
    type: ProcessorType;
    name: string;
};

/**
 * What a fresh add appends, byte for byte: the use case writes
 * `payload.name` verbatim (this handler always supplies it), so the forward
 * `describe()` can name the processor its remove-inverse has to guard against
 * before anything is written. Deriving the name anywhere else — e.g. from the
 * catalog — would guard a name the write never landed and wedge the entry's
 * undo forever.
 */
function toCreatedSnapshot(payload: AddPayload): YeastProcessorSnapshot {
    return { id: payload.processorId, type: payload.type, name: payload.name, bypassed: false, params: {} };
}

export const handleAddYeastProcessor = createHandler<'addYeastProcessor'>({
    // Conflicts on the restore leg when the processor is no longer absent (a
    // peer re-added it), and on a fresh add whose materialized id is already
    // taken. Proven by the `canReportConflict` registry honesty spec; undo
    // step-over (#2881) relies on it.
    canReportConflict: true,
    validate: (action) => {
        const state = readYeastRackState();
        if (!state) {
            return false;
        }
        return !findProcessor(state, action.payload.processorId);
    },
    execute: (action) => {
        const state = readYeastRackState();
        if (!state) {
            return { status: 'conflict' };
        }
        if (findProcessor(state, action.payload.processorId)) {
            return { status: 'conflict' };
        }
        const restore = action.payload.restore;
        if (restore) {
            // The guarded re-insert half of removeYeastProcessor's inverse. No
            // use case restores a processor, so this goes through the single
            // rack write path directly, preserving the runtime projection push.
            // The forward removal also deleted the processor's groove
            // assignments; the captured ones ride the restore payload and are
            // re-bound in the same batch (#4124) — straight store writes, never
            // a nested undoable dispatch, which would double-record the undo.
            batchStoreUpdates(() => {
                const processors = [...state.processors];
                const atIndex = Math.max(0, Math.min(restore.atIndex, processors.length));
                processors.splice(atIndex, 0, restore.processor);
                commitYeastProjection(processors);
                restoreYeastGrooveAssignments(restore.grooveAssignments ?? []);
            });
            return { status: 'written' };
        }
        addYeastProcessor(action.payload.type, action.payload.processorId, action.payload.name);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const restore = action.payload.restore;
        if (!restore) {
            return false;
        }
        const state = readYeastRackState();
        const restored = state ? findProcessor(state, action.payload.processorId) : undefined;
        return restored !== undefined && isSameProcessorSnapshot(restored, restore.processor);
    },
    describe: (action) => {
        const restore = action.payload.restore;
        if (restore) {
            return {
                label: 'Restore Yeast processor',
                inverseAction: {
                    type: 'removeYeastProcessor',
                    payload: {
                        processorId: action.payload.processorId,
                        expectedProcessor: restore.processor,
                        expectedIndex: restore.atIndex,
                    },
                },
            };
        }
        const state = readYeastRackState();
        const expectedIndex = state?.processors.length ?? 0;
        return {
            label: 'Add Yeast processor',
            inverseAction: {
                type: 'removeYeastProcessor',
                payload: {
                    processorId: action.payload.processorId,
                    expectedProcessor: toCreatedSnapshot(action.payload),
                    expectedIndex,
                },
            },
        };
    },
    undoable: true,
});
