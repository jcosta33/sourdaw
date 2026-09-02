import { trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { isRestoreMidiClipNotesReplayArguments } from '../../transformers/isRestoreMidiClipNotesReplayArguments';
import { getRestoreMidiClipNotesStatus } from '../../useCases/midiNoteTransforms/getRestoreMidiClipNotesStatus';
import { projectMidiNotesByClipIdThroughRestores } from '../../useCases/midiNoteTransforms/projectMidiNotesByClipIdThroughRestores';
import { restoreMidiClipNotes } from '../../useCases/midiNoteTransforms/restoreMidiClipNotes';

type RestoreMidiClipNotesAction = Extract<AppAction, { type: 'restoreMidiClipNotes' }>;

function getEarlierRestoreProjection(action: RestoreMidiClipNotesAction, context: HandlerValidationContext) {
    const notesByClipId = projectMidiNotesByClipIdThroughRestores(context.actions.slice(0, context.actionIndex));
    return {
        projectedNotes: notesByClipId[action.payload.clipId],
        projectedNotesBucketPresent: Object.hasOwn(notesByClipId, action.payload.clipId),
    };
}

function getProjectedNoteTransformReplayTarget(action: RestoreMidiClipNotesAction, context: HandlerValidationContext) {
    const guard = action.payload.noteTransformReplayGuard;
    if (!guard) {
        return undefined;
    }
    const clipProducer = context.actions
        .slice(0, context.actionIndex)
        .find(
            (candidate) =>
                candidate.type === 'addClip' &&
                candidate.payload.id === action.payload.clipId &&
                candidate.payload.trackId === guard.trackId &&
                candidate.payload.type === 'midi' &&
                candidate.payload.locked !== true
        );
    if (!clipProducer) {
        return undefined;
    }
    const liveTrack = trackStore.value?.tracks.find((track) => track.id === guard.trackId);
    if (liveTrack) {
        return {
            trackId: liveTrack.id,
            trackFrozen: liveTrack.frozen === true,
            clipLocked: false,
        };
    }
    const trackProducer = context.actions
        .slice(0, context.actionIndex)
        .find(
            (candidate) =>
                candidate.type === 'addTrack' &&
                candidate.payload.id === guard.trackId &&
                candidate.payload.kind === 'midi'
        );
    if (!trackProducer) {
        return undefined;
    }
    return {
        trackId: guard.trackId,
        trackFrozen: false,
        clipLocked: false,
    };
}

function getRestoreStatus(action: RestoreMidiClipNotesAction, context?: HandlerValidationContext) {
    return getRestoreMidiClipNotesStatus({
        ...action.payload,
        ...(context ? getEarlierRestoreProjection(action, context) : {}),
        ...(context
            ? { projectedNoteTransformReplayTarget: getProjectedNoteTransformReplayTarget(action, context) }
            : {}),
    });
}

/**
 * MF-03 replay eligibility: an inverse that carries no replay guard states nothing about the state
 * it expects, so re-applying it after divergence would write blind.
 */
function hasReplayGuard(action: RestoreMidiClipNotesAction): boolean {
    return (
        action.payload.articulationReplayGuard !== undefined || action.payload.noteTransformReplayGuard !== undefined
    );
}

export const handleRestoreMidiClipNotes = createHandler<'restoreMidiClipNotes'>({
    execute: (action) => ({ status: restoreMidiClipNotes(action.payload) }),
    validate: (action, context) =>
        isRestoreMidiClipNotesReplayArguments(action.payload) && getRestoreStatus(action, context) !== 'conflict',
    canReapplyAfterDivergence: (action, context) =>
        hasReplayGuard(action) &&
        isRestoreMidiClipNotesReplayArguments(action.payload) &&
        getRestoreStatus(action, context) !== 'conflict',
    describe: () => ({ label: 'Restore MIDI clip notes' }),
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionActionArguments: isRestoreMidiClipNotesReplayArguments,
    undoable: false,
});
