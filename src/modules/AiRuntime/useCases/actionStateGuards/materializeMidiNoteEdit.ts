import { type MaterializableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

type Action = Extract<MaterializableRuntimeAction, { type: 'editMidiNotes' }>;

export function materializeMidiNoteEdit(action: Action, state: MaterializationState): MaterializationStep {
    const scope = state.options.midiNoteEdit;
    if (!scope || action.payload.clipId !== scope.clipId) {
        return {
            status: 'rejected',
            reason: 'A selective MIDI edit requires the current admitted note selection and complete musical read',
        };
    }
    const allowed = new Set(scope.guard.scope.allowedNoteIds);
    const protectedIds = new Set(scope.guard.scope.protectedNoteIds);
    if (
        action.payload.operations.some(
            (operation) =>
                operation.type !== 'insert' && (!allowed.has(operation.noteId) || protectedIds.has(operation.noteId))
        )
    ) {
        return { status: 'rejected', reason: 'A proposed note is outside the admitted MIDI selection' };
    }
    return {
        status: 'accepted',
        actions: [{ type: 'editMidiNotes', payload: { ...action.payload, guard: scope.guard } }],
    };
}
