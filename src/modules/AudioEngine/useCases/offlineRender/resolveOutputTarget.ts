import { type AudioGraphRouteTarget } from '../../models/AudioGraphBackend';

export type ResolveOutputTargetInput = Readonly<{
    outputId: string | null | undefined;
    /** The strip whose stored output we are resolving — bus vs everything else. */
    sourceKind: 'bus' | 'track';
    /** Strip-id membership, whatever realizes the strips this render built. */
    busStripIds: Readonly<{ has: (id: string) => boolean }>;
    trackStripIds: Readonly<{ has: (id: string) => boolean }>;
}>;

/**
 * Which of the three destinations a strip's stored output id names, decided
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
    sourceKind,
    busStripIds,
    trackStripIds,
}: ResolveOutputTargetInput): AudioGraphRouteTarget {
    if (outputId === 'hw_out' || !outputId) {
        return { kind: 'master' };
    }
    if (busStripIds.has(outputId)) {
        return { kind: 'bus', busId: outputId };
    }
    // A bus's default outputId is the literal `'master'`, which is also the
    // master track's id and therefore sits in `trackStripIds`. Native sums
    // that bus at the master target — the engine summing point — rather than
    // as a bus-to-track edge the offline selector (and historically the
    // mapper) refuses. An ordinary track routed at the master track stays a
    // track target so its signal still enters the master strip's device chain.
    if (sourceKind === 'bus' && outputId === 'master') {
        return { kind: 'master' };
    }
    if (trackStripIds.has(outputId)) {
        return { kind: 'track', trackId: outputId };
    }
    return { kind: 'master' };
}
