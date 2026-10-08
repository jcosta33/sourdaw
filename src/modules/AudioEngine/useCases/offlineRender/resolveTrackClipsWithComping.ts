import { takeLaneStore, type TakeLaneStoreState, type Track } from '#/modules/Arrangement/stores';

import { liveTempoTimeline, type ResolutionTempoTimeline } from '../livePlayback/liveTempoTimeline';

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];
type TrackClip = Track['clips'][number];

export type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

/**
 * Mirrors `Arrangement/useCases/resolveComping.ts` (`resolveTakeMedia`,
 * `clipMediaOffsetAt`, `clipMediaOriginBeat`, `withMediaOffsetBeats`) so both
 * renderers read the same material for the same fragment (#2225). The law is
 * kept as a copy because the Arrangement `useCases` barrel pulls the whole
 * Arrangement graph, which cycles back through AudioEngine, into this pure
 * resolver.
 */
function clipMediaOriginBeat(clip: TrackClip): number {
    if (clip.type === 'audio') {
        return clip.startBeat - (clip.audioOffsetBeats ?? 0);
    }
    return clip.startBeat - (clip.midiOffsetBeats ?? 0);
}

/**
 * The offset a fragment of `clip` starting at `beat` carries to enter the
 * clip's own media at what sounds there: for audio, the clip's media seconds at
 * `beat` converted at that beat's tempo, the unit the reader seeks in; for
 * MIDI, beats from the media origin. At the clip's own start it is the clip's
 * own offset, exactly.
 */
function clipMediaOffsetAt(clip: TrackClip, beat: number, timeline: ResolutionTempoTimeline): number {
    if (beat === clip.startBeat) {
        return clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
    }
    if (clip.type !== 'audio') {
        return beat - clipMediaOriginBeat(clip);
    }
    const entrySeconds = ((clip.audioOffsetBeats ?? 0) * 60) / timeline.tempoAtBeat(clip.startBeat);
    const mediaSeconds = entrySeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(clip.startBeat);
    return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
}

/**
 * A take naming `sourceOffsetBeats` sounds that material `passStartBeats` after
 * the clip's media origin, so it follows every edit that moves the clip's
 * media. Every take is bounded by its clip's start, and a placed pass never
 * sounds before its own material. A take without an offset plays the clip's
 * media as the clip places it. `offsetAt` writes an audio fragment's offset
 * from the media seconds the pass sounds at its start beat, converted at that
 * beat's tempo.
 */
function resolveTakeMedia(
    take: Take,
    clip: TrackClip,
    timeline: ResolutionTempoTimeline
): { earliestBeat: number; sourceStartBeat: number; offsetAt: (beat: number) => number } {
    const clipOriginBeat = clipMediaOriginBeat(clip);
    if (take.sourceOffsetBeats === undefined) {
        return {
            earliestBeat: clip.startBeat,
            sourceStartBeat: clip.startBeat,
            offsetAt: (beat) => clipMediaOffsetAt(clip, beat, timeline),
        };
    }
    const sourceOffsetBeats = take.sourceOffsetBeats;
    const passShiftBeats = sourceOffsetBeats - (take.passStartBeats ?? 0);
    const passStartBeat = take.passStartBeats === undefined ? clip.startBeat : clipOriginBeat + take.passStartBeats;
    const earliestBeat = Math.max(clip.startBeat, passStartBeat);
    const sourceStartBeat = clip.startBeat - passShiftBeats;
    if (clip.type !== 'audio') {
        return { earliestBeat, sourceStartBeat, offsetAt: (beat) => beat - (clipOriginBeat - passShiftBeats) };
    }
    const passStartOffsetBeats =
        take.passStartBeats === undefined ? (clip.audioOffsetBeats ?? 0) + sourceOffsetBeats : sourceOffsetBeats;
    const passStartSeconds = (passStartOffsetBeats * 60) / timeline.tempoAtBeat(passStartBeat);
    return {
        earliestBeat,
        sourceStartBeat,
        offsetAt: (beat) => {
            const mediaSeconds =
                passStartSeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(passStartBeat);
            return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
        },
    };
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
 * interchangeable. `timeline` is the tempo map the caller's readers convert
 * each resolved offset against: a render passes its own, and a live producer
 * reads the session's.
 */
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
            ...withMediaOffsetBeats(sourceClip, media.offsetAt(overlapStart)),
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
                ...withMediaOffsetBeats(clip, clipMediaOffsetAt(clip, gap.start, timeline)),
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
