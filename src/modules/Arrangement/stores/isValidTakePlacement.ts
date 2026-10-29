function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Legacy takes may omit placement. A placed pass carries its anchor and depth
 * together beside its media offset. Its anchor may precede the media origin;
 * its material depth and offset cannot be negative. An exclusive source end
 * requires that complete placement and must leave material beyond its depth.
 */
export function isValidTakePlacement(value: object): boolean {
    if ('sourceOffsetBeats' in value && !isFiniteNonNegativeNumber(value.sourceOffsetBeats)) {
        return false;
    }
    const hasAnchor = 'passAnchorSeconds' in value;
    const hasDepth = 'passDepthSeconds' in value;
    if (!hasAnchor && !hasDepth) {
        return !('passSourceEndSeconds' in value);
    }
    return (
        hasAnchor &&
        hasDepth &&
        'sourceOffsetBeats' in value &&
        typeof value.passAnchorSeconds === 'number' &&
        Number.isFinite(value.passAnchorSeconds) &&
        isFiniteNonNegativeNumber(value.passDepthSeconds) &&
        (!('passSourceEndSeconds' in value) ||
            (isFiniteNonNegativeNumber(value.passSourceEndSeconds) &&
                value.passSourceEndSeconds > value.passDepthSeconds))
    );
}
