import { batchStoreUpdates } from '#/infra/store/createStore';
import { undoHistoryStore } from '#/modules/Command/stores';
import { markGrooveTemplateProjectWrite } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext, type YeastProcessorSnapshot } from '#/utils/handlerContract';

import { type ProcessorType } from '../models/ProcessorCatalog';
import { createInitialYeastProcessorParams } from '../models/createInitialYeastProcessorParams';
import { addYeastProcessor } from '../useCases/addYeastProcessor';
import { commitYeastProjection } from '../useCases/commitYeastProjection';
import { restoreYeastGrooveAssignments } from '../useCases/restoreYeastGrooveAssignments';

import { findProcessor, isSameProcessorSnapshot, readYeastRackState } from './rackState';

type AddPayload = {
    processorId: string;
    type: ProcessorType;
    name: string;
};

type AddAction = Extract<AppAction, { type: 'addYeastProcessor' }>;
type RemoveAction = Extract<AppAction, { type: 'removeYeastProcessor' }>;
type RecordedAdd = {
    readonly entryId: string;
    readonly action: AddAction;
    readonly inverseAction: RemoveAction;
    readonly snapshot: YeastProcessorSnapshot;
    readonly params: Readonly<Record<string, number>>;
    readonly expectedIndex: number;
    readonly isCurrent: () => boolean;
};

// Carries Command's live pending-entry capability across its describe/execute
// split. Neither action arguments nor the map grant replay authority on their
// own: each use rechecks the pending entry, its inverse and currentness.
const recordedAdds = new WeakMap<AddAction, RecordedAdd | null>();

function isCapturedInitialParams(type: ProcessorType, params: YeastProcessorSnapshot['params']): boolean {
    if (
        !params ||
        typeof params !== 'object' ||
        Array.isArray(params) ||
        Object.values(params).some((value) => !Number.isFinite(value))
    ) {
        return false;
    }
    if (Object.keys(params).length === 0) {
        return true;
    }
    return (
        type === 'arpeggiator' &&
        isSameProcessorSnapshot(
            { id: '', type, name: '', bypassed: false, params },
            { id: '', type, name: '', bypassed: false, params: createInitialYeastProcessorParams(type) }
        )
    );
}

function snapshotMatchesCreatedAdd(action: AddAction, snapshot: YeastProcessorSnapshot): boolean {
    return (
        snapshot.id === action.payload.processorId &&
        snapshot.type === action.payload.type &&
        snapshot.name === action.payload.name &&
        snapshot.bypassed === false &&
        isCapturedInitialParams(action.payload.type, snapshot.params)
    );
}

function findRecordedAdd(action: AddAction, context: HandlerValidationContext | undefined): RecordedAdd | null {
    const recorded = context?.recordedRedo;
    const inverseAction = recorded?.inverseAction;
    if (!recorded?.isCurrent() || inverseAction?.type !== 'removeYeastProcessor') {
        return null;
    }
    const state = readYeastRackState();
    const snapshot = inverseAction.payload.expectedProcessor;
    const params = snapshot?.params;
    const entry = undoHistoryStore.value?.future.find(
        (candidate) =>
            candidate.kind === 'action' &&
            (candidate.redoAction ?? candidate.action) === action &&
            candidate.inverseAction === inverseAction
    );
    if (
        !entry ||
        !state ||
        !snapshot ||
        !params ||
        inverseAction.payload.processorId !== action.payload.processorId ||
        !snapshotMatchesCreatedAdd(action, snapshot) ||
        !Number.isSafeInteger(inverseAction.payload.expectedIndex) ||
        inverseAction.payload.expectedIndex !== state.processors.length
    ) {
        return null;
    }
    return {
        entryId: entry.id,
        action,
        inverseAction,
        snapshot: structuredClone(snapshot),
        params: { ...params },
        expectedIndex: inverseAction.payload.expectedIndex,
        isCurrent: recorded.isCurrent,
    };
}

function recordedAddIsCurrent(capture: RecordedAdd, context?: HandlerValidationContext): boolean {
    const state = readYeastRackState();
    return (
        (context?.undoEntryId === undefined || context.undoEntryId === capture.entryId) &&
        capture.isCurrent() &&
        undoHistoryStore.value?.future.some(
            (entry) =>
                entry.kind === 'action' &&
                entry.id === capture.entryId &&
                (entry.redoAction ?? entry.action) === capture.action &&
                entry.inverseAction === capture.inverseAction
        ) === true &&
        state !== null &&
        state.processors.length === capture.expectedIndex &&
        capture.inverseAction.payload.expectedIndex === capture.expectedIndex &&
        snapshotMatchesCreatedAdd(capture.action, capture.snapshot) &&
        isSameProcessorSnapshot(capture.inverseAction.payload.expectedProcessor, capture.snapshot)
    );
}

/**
 * What a fresh add appends, byte for byte: the use case writes
 * `payload.name` verbatim (this handler always supplies it), so the forward
 * `describe()` can name the processor its remove-inverse has to guard against
 * before anything is written. Deriving the name anywhere else — e.g. from the
 * catalog — would guard a name the write never landed and wedge the entry's
 * undo forever.
 */
function toCreatedSnapshot(payload: AddPayload): YeastProcessorSnapshot {
    return {
        id: payload.processorId,
        type: payload.type,
        name: payload.name,
        bypassed: false,
        params: createInitialYeastProcessorParams(payload.type),
    };
}

export const handleAddYeastProcessor = createHandler<'addYeastProcessor'>({
    // Conflicts on the restore leg when the processor is no longer absent (a
    // peer re-added it), and on a fresh add whose materialized id is already
    // taken. Proven by the `canReportConflict` registry honesty spec; undo
    // step-over (#2881) relies on it.
    canReportConflict: true,
    validate: (action, context) => {
        const state = readYeastRackState();
        if (!state) {
            return false;
        }
        const capture = recordedAdds.get(action);
        if (recordedAdds.has(action) && (!capture || !recordedAddIsCurrent(capture, context))) {
            return false;
        }
        return !findProcessor(state, action.payload.processorId);
    },
    execute: (action, context) => {
        const hasCapture = recordedAdds.has(action);
        const capture = recordedAdds.get(action);
        recordedAdds.delete(action);
        const state = readYeastRackState();
        if (!state) {
            return { status: 'conflict' };
        }
        if (hasCapture && (!capture || !recordedAddIsCurrent(capture, context))) {
            return { status: 'conflict' };
        }
        if (
            !hasCapture &&
            undoHistoryStore.value?.future.some(
                (entry) => entry.kind === 'action' && (entry.redoAction ?? entry.action) === action
            )
        ) {
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
            let grooveChanged = false;
            batchStoreUpdates(() => {
                const processors = [...state.processors];
                const atIndex = Math.max(0, Math.min(restore.atIndex, processors.length));
                processors.splice(atIndex, 0, restore.processor);
                const reconciled = commitYeastProjection(processors);
                const restored = restoreYeastGrooveAssignments(restore.grooveAssignments ?? []);
                grooveChanged = reconciled || restored;
            });
            if (!grooveChanged) {
                return { status: 'written' };
            }
            return {
                status: 'written',
                afterCommit: markGrooveTemplateProjectWrite,
                afterAmbiguousCommit: markGrooveTemplateProjectWrite,
            };
        }
        const grooveChanged = capture
            ? addYeastProcessor(action.payload.type, action.payload.processorId, action.payload.name, capture.params)
            : addYeastProcessor(action.payload.type, action.payload.processorId, action.payload.name);
        if (!grooveChanged) {
            return { status: 'written' };
        }
        return {
            status: 'written',
            afterCommit: markGrooveTemplateProjectWrite,
            afterAmbiguousCommit: markGrooveTemplateProjectWrite,
        };
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
    describe: (action, context) => {
        recordedAdds.delete(action);
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
        if (context?.recordedRedo) {
            const capture = findRecordedAdd(action, context);
            recordedAdds.set(action, capture);
            return {
                label: 'Add Yeast processor',
                inverseAction: capture?.inverseAction ?? null,
            };
        }
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
