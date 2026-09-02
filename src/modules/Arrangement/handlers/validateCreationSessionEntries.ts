import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) {
        return false;
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]))
    );
}

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
