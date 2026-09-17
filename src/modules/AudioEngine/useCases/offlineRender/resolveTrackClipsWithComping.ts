import { takeLaneStore, type Track } from '#/modules/Arrangement/stores';

export type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

/**
 * A fragment's own media-entry offset.
 *
 * Every consumer — `projectOfflineAudioClipPlaybacks`, the Web Audio clip
 * scheduler, and the MIDI note projections — enters the material at the
 * fragment's own `startBeat` using the offset field alone; none of them adds a
 * displacement term of its own, and `sourceStartBeat` only carries the
 * loop-occurrence count for probability rolls. So a fragment that begins
 * partway into its source must carry that whole displacement here, or it sounds
 * the material from the clip's origin, late by the span it was displaced.
 *
 * `displacement` is measured from the media origin, which loop recording moves
 * behind the clip's own start: every pass lands in one continuous clip, and the
 * take — not the shared clip — names how deep its pass sits in that buffer.
 *
 * A fragment sitting exactly on the media origin leaves the clip's fields
 * untouched, so an unshifted region stays byte-identical to its source.
 * Mirrors the web resolver (`Arrangement/useCases/resolveComping.ts`) so both
 * renderers read the same material for the same fragment (#2225).
 */
function withFragmentOffset(clip: Track['clips'][number], displacement: number): Track['clips'][number] {
    if (displacement === 0) {
        return clip;
    }
    if (clip.type === 'audio') {
        return { ...clip, audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + displacement };
    }
    return { ...clip, midiOffsetBeats: (clip.midiOffsetBeats ?? 0) + displacement };
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
export function resolveTrackClipsWithComping(trackId: string, clips: Track['clips']): ResolvedClip[] {
    const laneState = takeLaneStore.value;
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

        const overlapStart = Math.max(region.startBeat, sourceClip.startBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        const passOffsetBeats = take.sourceOffsetBeats ?? 0;
        const mediaOriginBeat = sourceClip.startBeat - passOffsetBeats;

        resolvedClips.push({
            ...withFragmentOffset(sourceClip, overlapStart - mediaOriginBeat),
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: mediaOriginBeat,
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
                ...withFragmentOffset(clip, gap.start - clip.startBeat),
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
