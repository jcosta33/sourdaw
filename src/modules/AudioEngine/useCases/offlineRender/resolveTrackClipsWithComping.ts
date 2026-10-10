import { takeLaneStore, type TakeLaneStoreState, type Track } from '#/modules/Arrangement/stores';
import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { liveTempoTimeline, type ResolutionTempoTimeline } from '../livePlayback/liveTempoTimeline';

type Take = TakeLaneStoreState['lanes'][number]['takes'][number];
type TrackClip = Track['clips'][number];

export type ResolvedClip = Track['clips'][number] & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

type TakeMedia = { earliestBeat: number; sourceStartBeat: number; offsetAt: (beat: number) => number };

/*
 * Everything below mirrors `Arrangement/useCases/resolveComping.ts` and the
 * helpers it reads (`resolveTakeMedia`, `clipMediaOffsetAt`,
 * `withMediaOffsetBeats`, `models/TempoTimeline`) so both renderers read the
 * same material for the same fragment (#2225). The law is kept as a copy
 * because the Arrangement `useCases` barrel pulls the whole Arrangement graph,
 * which cycles back through AudioEngine, into this pure resolver.
 */

/** A render places beats on whole samples, so a constant span may be off by up to a sample. */
const CONSTANT_TEMPO_TOLERANCE_SECONDS = 1e-4;

function isTempoConstantBetween(timeline: ResolutionTempoTimeline, fromBeat: number, toBeat: number): boolean {
    const tempo = timeline.tempoAtBeat(fromBeat);
    if (timeline.tempoAtBeat(toBeat) !== tempo) {
        return false;
    }
    const spanSeconds = timeline.secondsAtBeat(toBeat) - timeline.secondsAtBeat(fromBeat);
    return Math.abs(spanSeconds - ((toBeat - fromBeat) * 60) / tempo) <= CONSTANT_TEMPO_TOLERANCE_SECONDS;
}

function clipEntrySeconds(timeline: ResolutionTempoTimeline, startBeat: number, mediaOffsetBeats: number): number {
    return (mediaOffsetBeats * 60) / timeline.tempoAtBeat(startBeat);
}

function clipOwnMediaOffset(clip: TrackClip): number {
    return clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
}

/**
 * The offset a fragment of `clip` starting at `beat` carries to enter the
 * clip's own media at what sounds there: beats added to the clip's own offset
 * for MIDI and across a span no tempo change lies in, and otherwise the clip's
 * media seconds at `beat` converted at that beat's tempo.
 */
function clipMediaOffsetAt(clip: TrackClip, beat: number, timeline: ResolutionTempoTimeline): number {
    const displacementBeats = beat - clip.startBeat;
    if (displacementBeats === 0) {
        return clipOwnMediaOffset(clip);
    }
    if (clip.type !== 'audio' || isTempoConstantBetween(timeline, clip.startBeat, beat)) {
        return clipOwnMediaOffset(clip) + displacementBeats;
    }
    const mediaSeconds =
        clipEntrySeconds(timeline, clip.startBeat, clip.audioOffsetBeats ?? 0) +
        timeline.secondsAtBeat(beat) -
        timeline.secondsAtBeat(clip.startBeat);
    return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
}

/** A pass saved before placement existed, or any MIDI pass: main's law. */
function legacyPassMedia(clip: TrackClip, sourceOffsetBeats: number, timeline: ResolutionTempoTimeline): TakeMedia {
    const mediaOriginBeat = clip.startBeat - sourceOffsetBeats;
    return {
        earliestBeat: clip.startBeat,
        sourceStartBeat: mediaOriginBeat,
        offsetAt: (beat) => {
            const displacementBeats = beat - mediaOriginBeat;
            if (displacementBeats === 0) {
                return clipOwnMediaOffset(clip);
            }
            if (clip.type !== 'audio' || isTempoConstantBetween(timeline, clip.startBeat, beat)) {
                return clipOwnMediaOffset(clip) + displacementBeats;
            }
            const passSeconds = clipEntrySeconds(
                timeline,
                clip.startBeat,
                (clip.audioOffsetBeats ?? 0) + sourceOffsetBeats
            );
            const mediaSeconds = passSeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(clip.startBeat);
            return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
        },
    };
}

/** The beat a clip's media reaches `anchorSeconds` on. */
function beatAtClipMediaSeconds(clip: TrackClip, anchorSeconds: number, timeline: ResolutionTempoTimeline): number {
    const entrySeconds = clipEntrySeconds(timeline, clip.startBeat, clip.audioOffsetBeats ?? 0);
    const constantTempoBeat =
        clip.startBeat + ((anchorSeconds - entrySeconds) * timeline.tempoAtBeat(clip.startBeat)) / 60;
    if (isTempoConstantBetween(timeline, clip.startBeat, constantTempoBeat)) {
        return constantTempoBeat;
    }
    return timeline.beatAtSeconds(timeline.secondsAtBeat(clip.startBeat) - entrySeconds + anchorSeconds);
}

/** A placed audio pass, held in media seconds. */
function placedPassMedia(
    clip: TrackClip,
    anchorSeconds: number,
    depthSeconds: number,
    timeline: ResolutionTempoTimeline
): TakeMedia {
    const passStartBeat = beatAtClipMediaSeconds(clip, anchorSeconds, timeline);
    const depthBeats = (depthSeconds * timeline.tempoAtBeat(passStartBeat)) / 60;
    return {
        earliestBeat: Math.max(clip.startBeat, passStartBeat),
        sourceStartBeat: passStartBeat - depthBeats,
        offsetAt: (beat) => {
            if (isTempoConstantBetween(timeline, passStartBeat, beat)) {
                return depthBeats + (beat - passStartBeat);
            }
            const mediaSeconds = depthSeconds + timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(passStartBeat);
            return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
        },
    };
}

function resolveTakeMedia(take: Take, clip: TrackClip, timeline: ResolutionTempoTimeline): TakeMedia {
    if (take.sourceOffsetBeats === undefined) {
        return {
            earliestBeat: clip.startBeat,
            sourceStartBeat: clip.startBeat,
            offsetAt: (beat) => clipMediaOffsetAt(clip, beat, timeline),
        };
    }
    if (clip.type !== 'audio' || take.passAnchorSeconds === undefined || take.passDepthSeconds === undefined) {
        return legacyPassMedia(clip, take.sourceOffsetBeats, timeline);
    }
    return placedPassMedia(clip, take.passAnchorSeconds, take.passDepthSeconds, timeline);
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
        const takeFragment = withMediaOffsetBeats(sourceClip, media.offsetAt(overlapStart));
        const { loopOriginBeat: _sourceLoopOrigin, ...takeFragmentBasis } = takeFragment;
        resolvedClips.push({
            ...takeFragmentBasis,
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
