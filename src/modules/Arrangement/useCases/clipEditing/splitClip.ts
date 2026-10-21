import { applyPreparedClipSplit } from './applyPreparedClipSplit';
import { prepareClipSplit } from './prepareClipSplit';

/** Split at the resolved audio seam, retaining supplied IDs for deterministic replay. */
export function splitClip(
    clipId: string,
    splitBeat: number,
    rightClipId?: string,
    targetNoteIds?: readonly string[],
    resolvedSplitBeat?: number
): string | null {
    if (!Number.isFinite(splitBeat) || (rightClipId !== undefined && typeof rightClipId !== 'string')) {
        return null;
    }
    const plan = prepareClipSplit({ clipId, splitBeat, rightClipId, resolvedSplitBeat, targetNoteIds });
    return plan && applyPreparedClipSplit(plan) ? plan.rightClipId : null;
}
