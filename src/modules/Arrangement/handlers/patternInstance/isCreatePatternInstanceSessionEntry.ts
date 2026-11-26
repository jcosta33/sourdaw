import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

/**
 * A saved instance creation is replayable only when it names the exact clip its undo removes:
 * materialization pins the id into the payload before the write is recorded, so a persisted entry
 * whose inverse removes another clip would delete material the creation never made. Redo re-runs the
 * forward action, so the entry carries no separate redo.
 */
export function isCreatePatternInstanceSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'createPatternInstance' ||
        entry.inverseAction?.type !== 'discardDuplicatedClip' ||
        entry.redoAction !== undefined
    ) {
        return false;
    }
    const action = entry.action.payload;
    return (
        action.sourceClipId.length > 0 &&
        action.targetTrackId.length > 0 &&
        Number.isFinite(action.startBeat) &&
        action.startBeat >= 0 &&
        typeof action.targetClipId === 'string' &&
        action.targetClipId.length > 0 &&
        action.targetClipId === entry.inverseAction.payload.clipId
    );
}
