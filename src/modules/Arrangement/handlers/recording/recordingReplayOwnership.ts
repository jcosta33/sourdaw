import { readUndoEntryForInverse } from '#/modules/Command/useCases';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type DiscardRecordingAction = Extract<AppAction, { type: 'discardRecording' }>;
type RestoreRecordingAction = Extract<AppAction, { type: 'restoreRecording' }>;

function originalRecordingOwner(action: DiscardRecordingAction): string | null {
    const entry = readUndoEntryForInverse(action);
    if (entry?.action.type !== 'commitRecording' || entry.redoAction?.type !== 'restoreRecording') {
        return null;
    }
    const original = entry.action.payload.clip;
    const restored = entry.redoAction.payload.clip;
    if (original.id !== action.payload.clipId || restored.id !== original.id || restored.trackId !== original.trackId) {
        return null;
    }
    return original.trackId;
}

/** The removal use case retires globally, so every occurrence must be authenticated. */
export function recordingDiscardOwnerMatches(
    action: DiscardRecordingAction,
    context?: HandlerValidationContext
): boolean {
    if (context?.executionMode === 'isolated-preview') {
        return false;
    }
    const owner = originalRecordingOwner(action);
    const state = getTrackStoreState();
    if (owner === null || !state) {
        return false;
    }
    let occurrences = 0;
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.id !== action.payload.clipId) {
                continue;
            }
            if (track.id !== owner || clip.trackId !== owner) {
                return false;
            }
            occurrences += 1;
        }
    }
    return occurrences === 1;
}

/** The typed redo captures its destination; no active owner may be overwritten. */
export function recordingRestoreTargetIsClear(
    action: RestoreRecordingAction,
    context?: HandlerValidationContext
): boolean {
    if (context?.executionMode === 'isolated-preview') {
        return false;
    }
    const state = getTrackStoreState();
    if (!state) {
        return false;
    }
    return (
        state.tracks.some((track) => track.id === action.payload.clip.trackId) &&
        state.tracks.every((track) => track.clips.every((clip) => clip.id !== action.payload.clip.id))
    );
}
