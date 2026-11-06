type BeatWindow = { readonly startBeat: number; readonly endBeat: number };

/** The comp mask used by both programme resolution and source read-set capture. */
export function compBaseGapWindows(clip: BeatWindow, sortedRegions: readonly BeatWindow[]): BeatWindow[] {
    const gaps: BeatWindow[] = [];
    let cursor = clip.startBeat;
    for (const region of sortedRegions) {
        if (region.endBeat <= clip.startBeat || region.startBeat >= clip.endBeat) {
            continue;
        }
        const regionStart = Math.max(region.startBeat, clip.startBeat);
        if (cursor < regionStart) {
            gaps.push({ startBeat: cursor, endBeat: regionStart });
        }
        cursor = Math.max(cursor, Math.min(region.endBeat, clip.endBeat));
    }
    if (cursor < clip.endBeat) {
        gaps.push({ startBeat: cursor, endBeat: clip.endBeat });
    }
    return gaps;
}
