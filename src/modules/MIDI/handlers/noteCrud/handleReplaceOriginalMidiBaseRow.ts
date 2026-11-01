import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type HandlerSessionActionEntry,
    type HandlerValidationContext,
    type OriginalMidiBaseRowReplacementPayload,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { midiStore } from '../../stores/midiStore';
import { prepareOriginalMidiBaseRowReplacement } from '../../useCases/midiNoteCrud/prepareOriginalMidiBaseRowReplacement';
import { getWritableMidiClipReplayGuardForBatch } from '../getWritableMidiClipReplayGuard';

type RowAction = Extract<AppAction, { type: 'replaceOriginalMidiBaseRow' }>;

function reverse(payload: OriginalMidiBaseRowReplacementPayload): OriginalMidiBaseRowReplacementPayload {
    return {
        ...payload,
        expected: payload.replacement,
        replacement: payload.expected,
        expectedSlotPresent: payload.replacementSlotPresent,
        replacementSlotPresent: payload.expectedSlotPresent,
    };
}

function isRowAction(action: AppAction | null | undefined): action is RowAction {
    return action?.type === 'replaceOriginalMidiBaseRow';
}

function projectedState(context: HandlerValidationContext) {
    let state = midiStore.value;
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (!isRowAction(action)) {
            continue;
        }
        state = prepareOriginalMidiBaseRowReplacement(action.payload, state);
        if (!state) {
            return null;
        }
    }
    return state;
}

function applies(action: RowAction, context?: HandlerValidationContext): boolean {
    return (
        getWritableMidiClipReplayGuardForBatch(action.payload.clipId, context) !== null &&
        prepareOriginalMidiBaseRowReplacement(action.payload, context ? projectedState(context) : midiStore.value) !==
            null
    );
}

function isRowSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (!isRowAction(entry.action) || !isRowAction(entry.inverseAction) || !isRowAction(entry.redoAction)) {
        return false;
    }
    const forward = entry.action.payload;
    return (
        valuesEqual(entry.inverseAction.payload, reverse(forward)) &&
        valuesEqual(entry.redoAction.payload, forward) &&
        (forward.expected === null || forward.expected.id === forward.rowId) &&
        (forward.replacement === null || forward.replacement.id === forward.rowId)
    );
}

export const handleReplaceOriginalMidiBaseRow = createHandler<'replaceOriginalMidiBaseRow'>({
    canReapplyAfterDivergence: (action) => applies(action),
    canReportConflict: true,
    validate: (action, context) => applies(action, context),
    execute: (action) => {
        if (getWritableMidiClipReplayGuardForBatch(action.payload.clipId) === null) {
            return { status: 'conflict' };
        }
        const next = prepareOriginalMidiBaseRowReplacement(action.payload, midiStore.value);
        if (!next) {
            return { status: 'conflict' };
        }
        midiStore.set(next);
        return { status: 'written' };
    },
    isNoop: (action) =>
        action.payload.expectedSlotPresent === action.payload.replacementSlotPresent &&
        valuesEqual(action.payload.expected, action.payload.replacement) &&
        applies(action),
    describe: (action) => ({
        label: 'Edit MIDI base row',
        inverseAction: { type: 'replaceOriginalMidiBaseRow', payload: reverse(action.payload) },
        redoAction: action,
    }),
    validateSessionEntry: isRowSessionEntry,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
