import { resolveTakeMedia, takeLaneStore, type Track } from '#/modules/Arrangement/stores';

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
            sourceStartBeat: clip.startBeat,
        }));
    }

    const lane = laneState.lanes.find((takeLane) => takeLane.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
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
                sourceStartBeat: clip.startBeat,
            });
        }
    }

    return resolvedClips.sort((leftClip, rightClip) => leftClip.startBeat - rightClip.startBeat);
}
