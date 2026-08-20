import { type AudioGraphRouteTarget } from '../../models/AudioGraphBackend';

export type ResolveOutputTargetInput = Readonly<{
    outputId: string | null | undefined;
    /** Strip-id membership, whatever realizes the strips this render built. */
    busStripIds: Readonly<{ has: (id: string) => boolean }>;
    trackStripIds: Readonly<{ has: (id: string) => boolean }>;
}>;

/**
 * Which of the three destinations a track's stored output id names, decided
 * from the strips this render actually built: a bus first, then a track, then
 * master — including master as the fallback for an output id naming nothing
 * this render created.
 *
 * Extracted from `renderOffline` (#2225) so the native export path decides
 * routing on the identical precedence; membership arrives as `has` so a strip
 * map and a plain id set answer the same question.
 */
export function resolveOutputTarget({
    outputId,
    busStripIds,
    trackStripIds,
}: ResolveOutputTargetInput): AudioGraphRouteTarget {
    if (outputId === 'hw_out' || !outputId) {
        return { kind: 'master' };
    }
    if (busStripIds.has(outputId)) {
        return { kind: 'bus', busId: outputId };
    }
    if (trackStripIds.has(outputId)) {
        return { kind: 'track', trackId: outputId };
    }
    return { kind: 'master' };
}
