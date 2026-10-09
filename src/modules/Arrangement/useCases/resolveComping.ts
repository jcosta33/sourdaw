import { takeLaneStore } from '../stores/takeLaneStore';
import { type Clip } from '../stores/trackStore';

import { liveTempoTimeline } from './liveTempoTimeline';
import { resolveTakeMedia } from './resolveTakeMedia';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
    const laneState = takeLaneStore.value;
    if (!laneState) {
        return clips.map((context) => ({
            ...context,
            regionStartBeat: context.startBeat,
            regionEndBeat: context.endBeat,
            sourceStartBeat: context.startBeat,
        }));
    }

    const lane = laneState.lanes.find((length) => length.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return clips.map((context) => ({
            ...context,
            regionStartBeat: context.startBeat,
            regionEndBeat: context.endBeat,
            sourceStartBeat: context.startBeat,
        }));
    }

    const resolved: ResolvedClip[] = [];

    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((time) => time.id === region.takeId);
        if (!take) {
            continue;
        }

        const sourceClip = clips.find((context) => context.id === take.clipId);
        if (!sourceClip) {
            continue;
        }

        const media = resolveTakeMedia(take, sourceClip, liveTempoTimeline);
        const overlapStart = Math.max(region.startBeat, media.earliestBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        resolved.push({
            ...media.clipAt(overlapStart),
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: media.sourceStartBeat,
        });
    }

    // §79.2 — setCompRegion.ts is the only writer and already sorts on
    // insert, so activeCompRegions is always already sorted. Use the
    // array directly instead of allocating a fresh \`[...x].sort(...)\`
    // copy on every comping resolution call.
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
            resolved.push({
                ...resolveTakeMedia({}, clip, liveTempoTimeline).clipAt(gap.start),
                startBeat: gap.start,
                endBeat: gap.end,
                regionStartBeat: gap.start,
                regionEndBeat: gap.end,
                sourceStartBeat: clip.startBeat,
            });
        }
    }

    return resolved.sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
}
