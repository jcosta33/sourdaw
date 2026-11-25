import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

/**
 * A saved disable or enable is replayable only when its undo restores what the action found, from
 * the state the action left, and its redo is that restore reversed, all on the one track. A restore
 * naming another track or other states is no inverse of this action, so a replay would write state
 * the action never produced.
 */
export function isDisableTrackSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (action.type !== 'disableTrack') {
        return false;
    }
    if (inverseAction === null) {
        return redoAction === undefined;
    }
    if (inverseAction.type !== 'restoreTrackDisabled' || redoAction?.type !== 'restoreTrackDisabled') {
        return false;
    }
    const { trackId, disabled } = action.payload;
    return (
        inverseAction.payload.trackId === trackId &&
        redoAction.payload.trackId === trackId &&
        inverseAction.payload.expected === disabled &&
        redoAction.payload.replacement === disabled &&
        redoAction.payload.expected === inverseAction.payload.replacement
    );
}
