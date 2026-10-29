import { hasValidAudioPassOrigin } from '#/utils/audioSourceTime';

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * File admission and store hydration share the complete take clock law. Legacy
 * takes may omit placement; present fields must never be sanitized into a
 * different source. A placed pass carries anchor and depth together beside its
 * beat offset, with an exclusive endpoint beyond its depth when recorded.
 */
export function isValidTakePlacement(value: object): boolean {
    if (
        !hasValidAudioPassOrigin(value) ||
        ('sourceOffsetBeats' in value && !isFiniteNonNegativeNumber(value.sourceOffsetBeats)) ||
        ('sourceOffsetSeconds' in value && !isFiniteNonNegativeNumber(value.sourceOffsetSeconds))
    ) {
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
