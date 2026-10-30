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
import {
    captureOriginalMidiTakeRowCopies,
    isWitnessedMidiCopyScope,
    prepareOriginalMidiTakeRowReplacement,
} from '../../useCases/comping/prepareOriginalMidiTakeRowReplacement';

type RowAction = Extract<AppAction, { type: 'replaceOriginalMidiTakeRow' }>;

function reverse(payload: OriginalMidiTakeRowReplacementPayload): OriginalMidiTakeRowReplacementPayload {
    const copyScope = isWitnessedMidiCopyScope(payload.copyScope)
        ? payload.copyScope.map((copy) => ({
              ...copy,
              expectedSlotPresent: copy.replacementSlotPresent,
              replacementSlotPresent: copy.expectedSlotPresent,
              expectedNextRowId: copy.replacementNextRowId,
              replacementNextRowId: copy.expectedNextRowId,
          }))
        : payload.copyScope;
    switch (payload.rowKind) {
        case 'note':
            return {
                ...payload,
                copyScope,
                expected: payload.replacement,
                replacement: payload.expected,
                expectedSlotPresent: payload.replacementSlotPresent,
                replacementSlotPresent: payload.expectedSlotPresent,
            };
        case 'cc':
            return {
                ...payload,
                copyScope,
                expected: payload.replacement,
                replacement: payload.expected,
                expectedSlotPresent: payload.replacementSlotPresent,
                replacementSlotPresent: payload.expectedSlotPresent,
            };
        case 'bend':
            return {
                ...payload,
                copyScope,
                expected: payload.replacement,
                replacement: payload.expected,
                expectedSlotPresent: payload.replacementSlotPresent,
                replacementSlotPresent: payload.expectedSlotPresent,
            };
    }
    throw new Error('Unsupported frozen MIDI row kind');
}

function applies(action: RowAction, context?: HandlerValidationContext): boolean {
    const state = takeLaneStore.value;
    if (!state) {
        return false;
    }
    let projected: typeof state | null = state;
    if (context) {
        projected = compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(state, context);
    }
    if (!projected) {
        return false;
    }
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
        isWitnessedMidiCopyScope(forward.copyScope) &&
        isWitnessedMidiCopyScope(inverse.copyScope) &&
        isWitnessedMidiCopyScope(redo.copyScope) &&
        valuesEqual(inverse, reverse(forward)) &&
        valuesEqual(redo, forward) &&
        (forward.expected === null || forward.rowId === forward.expected.id) &&
        (forward.replacement === null || forward.rowId === forward.replacement.id) &&
        (forward.expected !== null || forward.replacement !== null)
    );
}

export const handleReplaceOriginalMidiTakeRow = createHandler<'replaceOriginalMidiTakeRow'>({
    materializeCommandArgumentsAt: 'admission',
    materializeCommandArguments: (action, context) => {
        if (
            action.payload.copyScope !== 'capture' ||
            context?.undoEntryId !== undefined ||
            context?.recordedRedo !== undefined
        )
            return;
        const state = takeLaneStore.value;
        const projected =
            state && context
                ? compRegionInterval.projectTakeLaneStateThroughMaterializedActionPrefix(state, context)
                : state;
        const copyScope = captureOriginalMidiTakeRowCopies(action.payload, projected);
        if (copyScope) action.payload = { ...action.payload, copyScope };
    },
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
