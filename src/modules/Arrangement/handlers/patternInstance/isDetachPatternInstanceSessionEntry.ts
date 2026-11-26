import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

type RestoreLinkPayload = Extract<AppAction, { type: 'restorePatternInstanceLink' }>['payload'];

function readRestore(action: AppAction | null | undefined): RestoreLinkPayload | null {
    return action?.type === 'restorePatternInstanceLink' ? action.payload : null;
}

/**
 * A saved detach is replayable only when its undo puts back the link it removed, guarded on the
 * unlinked state the detach left, and its redo is that restore reversed, all on one clip. An undo
 * that expected another state would overwrite a newer edit, and a leg naming another clip would
 * rewrite a link the action never touched.
 */
export function isDetachPatternInstanceSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'detachPatternInstance') {
        return false;
    }
    if (entry.inverseAction === null) {
        return entry.redoAction === undefined;
    }
    const inverse = readRestore(entry.inverseAction);
    const redo = readRestore(entry.redoAction);
    if (inverse === null || redo === null) {
        return false;
    }
    const unlinked = { parentClipId: { present: false }, overrides: { present: false } };
    const linked = inverse.replacement.parentClipId;
    return (
        inverse.clipId === entry.action.payload.clipId &&
        redo.clipId === inverse.clipId &&
        redo.trackId === inverse.trackId &&
        valuesEqual(inverse.expected, unlinked) &&
        linked.present &&
        linked.value.length > 0 &&
        valuesEqual(redo.expected, inverse.replacement) &&
        valuesEqual(redo.replacement, inverse.expected)
    );
}
