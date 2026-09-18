import { takeLaneStore } from '../stores/takeLaneStore';
import { type Clip } from '../stores/trackStore';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

/**
 * A fragment's own media-entry offset.
 *
 * Every consumer — the offline audio projection, the Web Audio clip scheduler,
 * and the MIDI note projections — enters the material at the fragment's own
 * `startBeat` using the offset field alone; none of them adds a displacement
 * term of its own, and `sourceStartBeat` only carries the loop-occurrence
 * count for probability rolls. So a fragment that begins partway into its
 * source must carry that whole displacement here, or it sounds the material
 * from the clip's origin, late by the span it was displaced.
 *
 * `displacement` is measured from the media origin, which loop recording moves
 * behind the clip's own start: every pass lands in one continuous clip, and the
 * take — not the shared clip — names how deep its pass sits in that buffer.
 *
 * A fragment sitting exactly on the media origin leaves the clip's fields
 * untouched, so an unshifted region stays byte-identical to its source.
 */
function withFragmentOffset(clip: Clip, displacement: number): Clip {
    if (displacement === 0) {
        return clip;
    }
    if (clip.type === 'audio') {
        return { ...clip, audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + displacement };
    }
    return { ...clip, midiOffsetBeats: (clip.midiOffsetBeats ?? 0) + displacement };
}

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

        const overlapStart = Math.max(region.startBeat, sourceClip.startBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        const passOffsetBeats = take.sourceOffsetBeats ?? 0;
        const mediaOriginBeat = sourceClip.startBeat - passOffsetBeats;

        resolved.push({
            ...withFragmentOffset(sourceClip, overlapStart - mediaOriginBeat),
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: mediaOriginBeat,
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
                ...withFragmentOffset(clip, gap.start - clip.startBeat),
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
