type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isCcRow(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.controller) &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.beat) &&
        isFiniteNumber(value.channel)
    );
}

function isPitchBendRow(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.beat) &&
        isFiniteNumber(value.channel)
    );
}

function isClipRows(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        Array.isArray(value.cc) &&
        value.cc.every(isCcRow) &&
        Array.isArray(value.pitchBend) &&
        value.pitchBend.every(isPitchBendRow)
    );
}

function hasDistinctRowIds(clips: readonly JsonRecord[]): boolean {
    const ids = clips.flatMap((clip) =>
        [...(clip.cc as JsonRecord[]), ...(clip.pitchBend as JsonRecord[])].map((row) => row.id)
    );
    return new Set(ids).size === ids.length;
}

/**
 * Whether an `appendOverdubControllers` payload is well formed: every clip names
 * its rows with finite numbers and a string id, and no id repeats across the
 * pass, because the inverse removes rows by id.
 */
export function isOverdubControllerRowsPayload(payload: unknown): boolean {
    if (!isRecord(payload) || !Array.isArray(payload.clips) || !payload.clips.every(isClipRows)) {
        return false;
    }
    return hasDistinctRowIds(payload.clips as JsonRecord[]);
}
