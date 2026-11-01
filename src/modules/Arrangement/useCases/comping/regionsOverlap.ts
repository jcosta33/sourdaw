import { type CompRegion } from '../../models/TakeLane';

/**
 * Touching regions (`left.endBeat === right.startBeat`) do not overlap,
 * matching the store's own retention, which keeps a region whose start is at
 * the previous region's end.
 */
export function regionsOverlap(
    left: Pick<CompRegion, 'startBeat' | 'endBeat'>,
    right: Pick<CompRegion, 'startBeat' | 'endBeat'>
): boolean {
    return left.startBeat < right.endBeat && right.startBeat < left.endBeat;
}
