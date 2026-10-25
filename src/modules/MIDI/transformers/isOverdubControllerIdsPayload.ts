function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isClipRowIds(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        isStringArray(value.ccIds) &&
        isStringArray(value.pitchBendIds) &&
        typeof value.ccListExisted === 'boolean' &&
        typeof value.pitchBendListExisted === 'boolean'
    );
}

/**
 * Whether a `removeOverdubControllers` payload names each clip by id with string row ids and
 * says whether each of its lists existed before the pass.
 */
export function isOverdubControllerIdsPayload(payload: unknown): boolean {
    return isRecord(payload) && Array.isArray(payload.clips) && payload.clips.every(isClipRowIds);
}
