import { type Take } from './TakeLane';
import { type Clip } from './Track';

type BeatSpan = { minBeat: number; maxBeat: number };

const EMPTY_SPAN: BeatSpan = { minBeat: 0, maxBeat: 16 };
const MINIMUM_SPAN_BEATS = 4;

/**
 * The beat range the Takes panel maps onto its strips. It covers every clip and
 * every take of the lane, because a take recorded past (or before) its clip is
 * still a swipe target and must draw inside its strip.
 */
export function resolveTakeLaneSpan(
    clips: readonly Pick<Clip, 'startBeat' | 'endBeat'>[],
    takes: readonly Pick<Take, 'startBeat' | 'endBeat'>[]
): BeatSpan {
    const extents = [...clips, ...takes];
    if (extents.length === 0) {
        return EMPTY_SPAN;
    }
    const minBeat = Math.max(0, Math.min(...extents.map((extent) => extent.startBeat)));
    const maxBeat = Math.max(...extents.map((extent) => extent.endBeat));
    return { minBeat, maxBeat: Math.max(maxBeat, minBeat + MINIMUM_SPAN_BEATS) };
}
