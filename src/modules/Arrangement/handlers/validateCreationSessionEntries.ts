import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

function isCompleteGeneratedMidiStateGuard(value: unknown, entityId: string): boolean {
    if (
        !isRecord(value) ||
        Object.keys(value).length !== 2 ||
        typeof value.entityJson !== 'string' ||
        typeof value.midiByClipIdJson !== 'string'
    ) {
        return false;
    }
    try {
        const entity: unknown = JSON.parse(value.entityJson);
        const midiByClipId: unknown = JSON.parse(value.midiByClipIdJson);
        return isRecord(entity) && entity.id === entityId && isRecord(midiByClipId);
    } catch {
        return false;
    }
}

export function isAddTrackSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'addTrack' ||
        entry.inverseAction?.type !== 'discardCreatedTrack' ||
        entry.redoAction !== undefined
    ) {
        return false;
    }
    const trackId = entry.action.payload.id;
    return (
        typeof trackId === 'string' &&
        trackId.length > 0 &&
        entry.inverseAction.payload.trackId === trackId &&
        isCompleteGeneratedMidiStateGuard(entry.inverseAction.payload.generatedMidiStateGuard, trackId)
    );
}

export function isAddClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'addClip' ||
        entry.inverseAction?.type !== 'discardDuplicatedClip' ||
        entry.redoAction?.type !== 'addClip'
    ) {
        return false;
    }
    const clipId = entry.inverseAction.payload.clipId;
    if (
        clipId.length === 0 ||
        (entry.action.payload.id !== undefined && entry.action.payload.id !== clipId) ||
        !isCompleteGeneratedMidiStateGuard(entry.inverseAction.payload.generatedMidiStateGuard, clipId)
    ) {
        return false;
    }
    return valuesEqual(entry.redoAction.payload, { ...entry.action.payload, id: clipId });
}
