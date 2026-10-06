import { takeLaneStore, type TakeLaneStoreState, type Track } from '#/modules/Arrangement/stores';

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];
type TrackClip = Track['clips'][number];

export type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

/**
 * Mirrors `Arrangement/useCases/resolveComping.ts` (`resolveTakeMedia`,
 * `clipMediaOriginBeat`, `withMediaOffsetBeats`) so both renderers read the same
 * material for the same fragment (#2225). The law is kept as a copy because the
 * Arrangement `useCases` barrel pulls the whole Arrangement graph, which cycles
 * back through AudioEngine, into this pure resolver.
 */
function clipMediaOriginBeat(clip: TrackClip): number {
    if (clip.type === 'audio') {
        return clip.startBeat - (clip.audioOffsetBeats ?? 0);
    }
    return clip.startBeat - (clip.midiOffsetBeats ?? 0);
}

/**
 * A take naming `sourceOffsetBeats` places the material that deep into the
 * recording's media at its own `startBeat`, so its origin is measured from the
 * take. A take without one plays the clip's media as the clip places it.
 */
function resolveTakeMedia(
    take: Take,
    clip: TrackClip
): { originBeat: number; earliestBeat: number; sourceStartBeat: number } {
    if (take.sourceOffsetBeats === undefined) {
        return {
            originBeat: clipMediaOriginBeat(clip),
            earliestBeat: clip.startBeat,
            sourceStartBeat: clip.startBeat,
        };
    }
    const originBeat = take.startBeat - take.sourceOffsetBeats;
    return { originBeat, earliestBeat: originBeat, sourceStartBeat: originBeat };
}

/**
 * Every consumer enters a fragment's material using the offset field alone, so
 * the fragment carries its whole distance from the media origin. A fragment
 * already on the clip's own offset leaves the clip untouched.
 */
function withMediaOffsetBeats(clip: TrackClip, offsetBeats: number): TrackClip {
    if (clip.type === 'audio') {
        if (offsetBeats === (clip.audioOffsetBeats ?? 0)) {
            return clip;
        }
        return { ...clip, audioOffsetBeats: offsetBeats };
    }
    if (offsetBeats === (clip.midiOffsetBeats ?? 0)) {
        return clip;
    }
    return { ...clip, midiOffsetBeats: offsetBeats };
}

/**
 * The clip set a track actually plays: comped takes where a take lane has
 * active regions, gap fills where the original clip still shows through, and
 * the clips unchanged when no comping applies.
 *
 * Shared by both renderers (#2225): the Web Audio scheduler
 * (`scheduleTrackClips`) and the native export path must schedule exactly the
 * same clip set — comped takes and gap fills included — for the two to be
 * interchangeable.
 */
export function resolveTrackClipsWithComping(
    trackId: string,
    clips: Track['clips'],
    laneState = takeLaneStore.value
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

        const media = resolveTakeMedia(take, sourceClip);
        const overlapStart = Math.max(region.startBeat, media.earliestBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        resolvedClips.push({
            ...withMediaOffsetBeats(sourceClip, overlapStart - media.originBeat),
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
                ...withMediaOffsetBeats(clip, gap.start - clipMediaOriginBeat(clip)),
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
