import { type TempoAudioSourceTransition } from '#/utils/handlerContract';

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === keys.length &&
        keys.every((key) => Object.hasOwn(value, key))
    );
}

function nonempty(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function nullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function validClipIdentity(source: Record<string, unknown>): boolean {
    return (
        nonempty(source.trackId) &&
        nonempty(source.clipId) &&
        (source.alternativeId === null || nonempty(source.alternativeId)) &&
        nullableString(source.audioBufferId) &&
        nullableString(source.fileId) &&
        nullableString(source.assetHash)
    );
}

function validClipGeometry(source: Record<string, unknown>): boolean {
    return finite(source.startBeat) && finite(source.endBeat) && source.endBeat > source.startBeat;
}

function validClipDepth(source: Record<string, unknown>): boolean {
    return (
        finite(source.originalTempo) &&
        source.originalTempo > 0 &&
        finite(source.audioOffsetBeats) &&
        finite(source.audioOffsetSeconds) &&
        Object.is(source.audioOffsetSeconds, source.audioOffsetBeats * (60 / source.originalTempo))
    );
}

function validClipSource(value: unknown): value is Record<string, unknown> {
    return (
        exactKeys(value, [
            'trackId',
            'alternativeId',
            'clipId',
            'startBeat',
            'endBeat',
            'audioBufferId',
            'fileId',
            'assetHash',
            'originalTempo',
            'audioOffsetBeats',
            'audioOffsetSeconds',
        ]) &&
        validClipIdentity(value) &&
        validClipGeometry(value) &&
        validClipDepth(value)
    );
}

function validTakeIdentity(source: Record<string, unknown>): boolean {
    return (
        nonempty(source.laneId) &&
        nonempty(source.trackId) &&
        nonempty(source.takeId) &&
        nonempty(source.clipId) &&
        (source.alternativeId === null || nonempty(source.alternativeId)) &&
        nullableString(source.audioBufferId) &&
        nullableString(source.fileId) &&
        nullableString(source.assetHash)
    );
}

function validTakeGeometry(source: Record<string, unknown>): boolean {
    return (
        finite(source.clipStartBeat) &&
        finite(source.clipEndBeat) &&
        source.clipEndBeat > source.clipStartBeat &&
        finite(source.startBeat) &&
        finite(source.endBeat) &&
        source.endBeat > source.startBeat
    );
}

function validTakeDepth(source: Record<string, unknown>): boolean {
    return (
        finite(source.originalTempo) &&
        source.originalTempo > 0 &&
        finite(source.sourceOffsetBeats) &&
        source.sourceOffsetBeats >= 0 &&
        finite(source.sourceOffsetSeconds) &&
        source.sourceOffsetSeconds >= 0 &&
        Object.is(source.sourceOffsetSeconds, source.sourceOffsetBeats * (60 / source.originalTempo))
    );
}

function validTakeSource(value: unknown): value is Record<string, unknown> {
    return (
        exactKeys(value, [
            'laneId',
            'trackId',
            'takeId',
            'clipId',
            'alternativeId',
            'clipStartBeat',
            'clipEndBeat',
            'audioBufferId',
            'fileId',
            'assetHash',
            'startBeat',
            'endBeat',
            'originalTempo',
            'sourceOffsetBeats',
            'sourceOffsetSeconds',
        ]) &&
        validTakeIdentity(value) &&
        validTakeGeometry(value) &&
        validTakeDepth(value)
    );
}

function uniqueRows(
    rows: readonly unknown[],
    valid: (row: unknown) => row is Record<string, unknown>,
    key: (row: Record<string, unknown>) => string
): boolean {
    const seen = new Set<string>();
    for (const row of rows) {
        if (!valid(row)) {
            return false;
        }
        const identity = key(row);
        if (seen.has(identity)) {
            return false;
        }
        seen.add(identity);
    }
    return true;
}

export function isTempoAudioSourceTransition(value: unknown): value is TempoAudioSourceTransition {
    if (!exactKeys(value, ['version', 'direction', 'clips', 'takes'])) {
        return false;
    }
    if (
        value.version !== 1 ||
        (value.direction !== 'apply' && value.direction !== 'restore') ||
        !Array.isArray(value.clips) ||
        !Array.isArray(value.takes)
    ) {
        return false;
    }
    const clips: unknown[] = value.clips;
    const takes: unknown[] = value.takes;
    return (
        uniqueRows(clips, validClipSource, (row) => JSON.stringify([row.trackId, row.alternativeId, row.clipId])) &&
        uniqueRows(takes, validTakeSource, (row) => JSON.stringify([row.laneId, row.takeId]))
    );
}
