function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Legacy takes may omit placement. A placed pass carries its anchor and depth
 * together beside its media offset. Its anchor may precede the media origin;
 * its material depth and offset cannot be negative.
 */
export function isValidTakePlacement(value: object): boolean {
    if ('sourceOffsetBeats' in value && !isFiniteNonNegativeNumber(value.sourceOffsetBeats)) {
        return false;
    }
    const hasAnchor = 'passAnchorSeconds' in value;
    const hasDepth = 'passDepthSeconds' in value;
    if (!hasAnchor && !hasDepth) {
        return true;
    }
    return (
        hasAnchor &&
        hasDepth &&
        'sourceOffsetBeats' in value &&
        typeof value.passAnchorSeconds === 'number' &&
        Number.isFinite(value.passAnchorSeconds) &&
        isFiniteNonNegativeNumber(value.passDepthSeconds)
    );
}
