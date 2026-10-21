import { resolveTakeMedia, takeLaneStore, type Track } from '#/modules/Arrangement/stores';
import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { liveTempoTimeline, type ResolutionTempoTimeline } from '../livePlayback/liveTempoTimeline';

export type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

export function resolveTrackClipsWithComping(
    trackId: string,
    clips: Track['clips'],
    laneState = takeLaneStore.value,
    timeline: ResolutionTempoTimeline = liveTempoTimeline
): ResolvedClip[] {
    if (!laneState) {
        return clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            // The pass count measures from the loop anchor, not the current
            // placement: a start trim must not re-roll which passes sound
            // (#4988). Unanchored clips anchor at their current start, which is
            // exactly the pre-anchor reading.
            sourceStartBeat: resolveLoopAnchoredStartBeat({
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopEnabled: clip.loopEnabled ?? false,
            }),
        }));
    }

    const lane = laneState.lanes.find((takeLane) => takeLane.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: resolveLoopAnchoredStartBeat({
                startBeat: clip.startBeat,
                loopOriginBeat: clip.loopOriginBeat,
                loopEnabled: clip.loopEnabled ?? false,
            }),
        }));
    }

    const resolvedClips: ResolvedClip[] = [];

    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((candidateTake) => candidateTake.id === region.takeId);
        if (!take) {
            continue;
        }

        const sourceClip = clips.find((clip) => clip.id === take.clipId);
        if (!sourceClip) {
            continue;
        }

        const media = resolveTakeMedia(take, sourceClip, timeline);
        const overlapStart = Math.max(region.startBeat, media.earliestBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        // A comped take fragment's media basis is the take's own: `offsetAt`
        // names what sounds at the region head in take coordinates, so the
        // offset carried below enters that basis at relative 0 and the source
        // clip's loop anchor has no meaning in it — the take's offset never
        // accumulated the anchor's trim advance. Carried through, the
        // loop-window readers derive advance = fragmentStart − anchor from the
        // fragment and pull the read off the comped material onto an earlier
        // pass's (#5198: a region one loop past the anchor read pass 1 at
        // buffer 0 instead of pass 3 at buffer 4). The anchor is therefore
        // stripped and the fragment reads the pre-anchor law — window opening
        // at its own offset, exactly the placed media it read before anchoring
        // existed. Gap fragments below keep the anchor: their offset advances
        // with the same beat as the window, so the source's region law holds
        // there unchanged.
        resolvedClips.push({
            ...media.clipAt(overlapStart),
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: media.sourceStartBeat,
        });
    }

    const sortedRegions = lane.activeCompRegions;

    for (const clip of clips) {
        const gaps: { start: number; end: number }[] = [];
        let cursor = clip.startBeat;

        for (const region of sortedRegions) {
            if (region.endBeat <= clip.startBeat || region.startBeat >= clip.endBeat) {
                continue;
            }
            const regionStart = Math.max(region.startBeat, clip.startBeat);
            if (cursor < regionStart) {
                gaps.push({ start: cursor, end: regionStart });
            }
            cursor = Math.max(cursor, Math.min(region.endBeat, clip.endBeat));
        }
        if (cursor < clip.endBeat) {
            gaps.push({ start: cursor, end: clip.endBeat });
        }

        for (const gap of gaps) {
            resolvedClips.push({
                ...resolveTakeMedia({}, clip, timeline).clipAt(gap.start),
                startBeat: gap.start,
                endBeat: gap.end,
                regionStartBeat: gap.start,
                regionEndBeat: gap.end,
                sourceStartBeat: resolveLoopAnchoredStartBeat({
                    startBeat: clip.startBeat,
                    loopOriginBeat: clip.loopOriginBeat,
                    loopEnabled: clip.loopEnabled ?? false,
                }),
            });
        }
    }

    return resolvedClips.sort((leftClip, rightClip) => leftClip.startBeat - rightClip.startBeat);
}
