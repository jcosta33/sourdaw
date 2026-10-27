import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type HandlerSessionActionEntry,
    type HandlerValidationContext,
    type OriginalMidiTakeRowReplacementPayload,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { compRegionInterval } from '../../useCases/comping/compRegionInterval';
import { prepareOriginalMidiTakeRowReplacement } from '../../useCases/comping/replaceOriginalMidiTakeRow';

type RowAction = Extract<AppAction, { type: 'replaceOriginalMidiTakeRow' }>;

function reverse(payload: OriginalMidiTakeRowReplacementPayload): OriginalMidiTakeRowReplacementPayload {
    switch (payload.rowKind) {
        case 'note':
            return { ...payload, expected: payload.replacement, replacement: payload.expected };
        case 'cc':
            return { ...payload, expected: payload.replacement, replacement: payload.expected };
        case 'bend':
            return { ...payload, expected: payload.replacement, replacement: payload.expected };
    }
}

function applies(action: RowAction, context?: HandlerValidationContext): boolean {
    const state = takeLaneStore.value;
    const projected = context
        ? compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(state, context)
        : state;
    return prepareOriginalMidiTakeRowReplacement(action.payload, projected) !== null;
}

function isRowAction(action: AppAction | null | undefined): action is RowAction {
    return action?.type === 'replaceOriginalMidiTakeRow';
}

function isRowSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (!isRowAction(entry.action) || !isRowAction(entry.inverseAction) || !isRowAction(entry.redoAction)) {
        return false;
    }
    const forward = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    return (
        valuesEqual(inverse, reverse(forward)) &&
        valuesEqual(redo, forward) &&
        forward.rowId === forward.expected.id &&
        forward.rowId === forward.replacement.id
    );
}

export const handleReplaceOriginalMidiTakeRow = createHandler<'replaceOriginalMidiTakeRow'>({
    canReapplyAfterDivergence: () => true,
    canReportConflict: true,
    validate: (action, context) => applies(action, context),
    execute: (action) => {
        const next = prepareOriginalMidiTakeRowReplacement(action.payload, takeLaneStore.value);
        if (!next) {
            return { status: 'conflict' };
        }
        takeLaneStore.set(next);
        return { status: 'written' };
    },
    isNoop: (action) => valuesEqual(action.payload.expected, action.payload.replacement) && applies(action),
    describe: (action) => ({
        label: 'Edit MIDI take row',
        inverseAction: { type: 'replaceOriginalMidiTakeRow', payload: reverse(action.payload) },
        redoAction: action,
    }),
    validateSessionEntry: isRowSessionEntry,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
