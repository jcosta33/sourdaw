import { type AppActionType, type HandlerValidationContext } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { midiStore } from '../../stores/midiStore';

import { projectMidiNoteWrite } from './projectMidiNoteWrite';

// These actions can change existing clip ownership, geometry or MIDI rows without naming the clip.
const GLOBAL_WRITES = new Set<AppActionType>([
    'removeAllTracks',
    'deleteTime',
    'insertTime',
    'duplicateTimeRange',
    'restoreTimeOperationState',
    'cutClip',
    'pasteClip',
    'consolidateSelection',
    'consolidateAllTracks',
    'repairProjectData',
    'commitRecording',
    'discardRecording',
    'restoreRecording',
    'restoreProjectVersion',
    'createProjectFromTemplate',
    'newProject',
]);

const TRACK_WRITES = new Set<AppActionType>([
    'removeTrack',
    'discardCreatedTrack',
    'restoreTrack',
    'restoreTracks',
    'discardCreatedTracks',
    'switchTrackAlternative',
    'restoreTrackAlternativeState',
    'restoreTrackClipStates',
    'restoreScratchPadState',
    'freezeTrack',
    'unfreezeTrack',
    'restoreFreezeState',
    'flattenTrack',
    'bounceInPlace',
]);

function namesTarget(value: unknown, id: string): boolean {
    if (value === id) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.some((entry) => namesTarget(entry, id));
    }
    return isRecord(value) && Object.values(value).some((entry) => namesTarget(entry, id));
}

function isNoteWrite(
    action: NonNullable<HandlerValidationContext>['actions'][number]
): action is Extract<typeof action, { type: 'addNotes' | 'editMidiNotes' | 'restoreMidiClipNotes' }> {
    return action.type === 'addNotes' || action.type === 'editMidiNotes' || action.type === 'restoreMidiClipNotes';
}

/** Refuse an unprojected predecessor that may change the selected row bucket or its owner. */
export function projectMidiNoteEditPrefix(clipId: string, trackId: string, context?: HandlerValidationContext) {
    const state = midiStore.value;
    if (!state) {
        return null;
    }
    let bucket: { present: boolean; value: readonly unknown[] } = {
        present: Object.hasOwn(state.notesByClipId, clipId),
        value: state.notesByClipId[clipId] ?? [],
    };
    for (const action of context?.actions.slice(0, context.actionIndex) ?? []) {
        if (isNoteWrite(action)) {
            const projected = projectMidiNoteWrite(action, clipId, bucket, true);
            if (!projected) {
                return null;
            }
            bucket = projected;
            continue;
        }
        if (
            GLOBAL_WRITES.has(action.type) ||
            namesTarget(action.payload, clipId) ||
            (TRACK_WRITES.has(action.type) && namesTarget(action.payload, trackId))
        ) {
            return null;
        }
    }
    return bucket;
}
