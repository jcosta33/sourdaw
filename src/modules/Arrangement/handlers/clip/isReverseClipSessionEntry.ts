import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';

type RestorePayload = Extract<AppAction, { type: 'restoreReversedClip' }>['payload'];

function readRestore(action: AppAction | null | undefined): RestorePayload | null {
    return action?.type === 'restoreReversedClip' ? action.payload : null;
}

/** The undo guards on the reversed buffer and puts the original back; the redo is that swap the other way. */
function swapsBuffers(inverse: RestorePayload, redo: RestorePayload, reversedBufferId: string): boolean {
    return (
        inverse.expectedAudioBufferId === reversedBufferId &&
        redo.audioBufferId === reversedBufferId &&
        inverse.audioBufferId.length > 0 &&
        inverse.audioBufferId !== reversedBufferId &&
        redo.expectedAudioBufferId === inverse.audioBufferId
    );
}

/** The redo names what the forward run wrote: the suffixed name and the fades traded places. */
function mirrorsNameAndFades(inverse: RestorePayload, redo: RestorePayload): boolean {
    return (
        redo.name === `${inverse.name} (reversed)` &&
        redo.fadeInBeats === inverse.fadeOutBeats &&
        redo.fadeOutBeats === inverse.fadeInBeats
    );
}

/**
 * A saved reverse is replayable only when its undo puts back the buffer the clip held, guarded on the
 * reversed buffer the forward run minted, and its redo is the same swap in the other direction, all on
 * one clip. A leg guarded on another buffer would overwrite a newer edit, and a leg naming another clip
 * would swap audio the action never touched.
 */
export function isReverseClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'reverseClip') {
        return false;
    }
    if (entry.inverseAction === null) {
        return entry.redoAction === undefined;
    }
    const { clipId, reversedBufferId } = entry.action.payload;
    const inverse = readRestore(entry.inverseAction);
    const redo = readRestore(entry.redoAction);
    if (inverse === null || redo === null || reversedBufferId === undefined || reversedBufferId.length === 0) {
        return false;
    }
    return (
        inverse.clipId === clipId &&
        redo.clipId === clipId &&
        swapsBuffers(inverse, redo, reversedBufferId) &&
        mirrorsNameAndFades(inverse, redo)
    );
}
