import { boundStretchRatio } from '#/utils/stretchRatioBound';

/**
 * The stretch factor the audio runtimes apply to content consumed over a span
 * of timeline beats: 1x unless stretch is on, the bounded ratio when it is
 * (`boundStretchRatio` — the same bound the live scheduler and the offline
 * projector evaluate; the stored ratio is only hydrate-admissible finite, not
 * in range). The single source both split paths and the reverse remap route
 * through, so the audio, warp, and reverse axes cannot disagree about how
 * much content an edit consumed.
 */
export function consumedStretchFactor(input: { stretchMode?: string; stretchRatio?: number }): number {
    if (!input.stretchMode || input.stretchMode === 'off') {
        return 1;
    }
    return boundStretchRatio(input.stretchRatio ?? 1);
}
