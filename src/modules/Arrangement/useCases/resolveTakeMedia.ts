import { boundStretchRatio } from '#/utils/stretchRatioBound';

import { type Take } from '../models/TakeLane';
import { clipEntrySeconds, isTempoConstantBetween, type TempoTimeline } from '../models/TempoTimeline';
import { type Clip } from '../stores/trackStore';

import { clipMediaOffsetAt } from './clipMediaOffsetAt';

type TakeMedia = {
    /** The first beat the take can sound. */
    earliestBeat: number;
    latestBeatAt?: (fragmentStartBeat: number) => number;
    /** Carries the loop-occurrence count for probability rolls. */
    sourceStartBeat: number;
    /** The media offset a fragment of the take starting at `beat` carries. */
    offsetAt: (beat: number) => number;
};

/** A clip's own media offset, in the field its readers read. */
function clipOwnMediaOffset(clip: Clip): number {
    return clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
}

/**
 * A pass saved before placement existed, or any MIDI pass: main's law. Its
 * material, `sourceOffsetBeats` deep into the media, sounds from its clip's
 * start, bounded by the clip alone, and beats are added to the clip's own
 * offset. An audio fragment across a tempo change takes that depth at the
 * clip's start in media seconds instead, as the clip's own media does.
 */
function legacyPassMedia(clip: Clip, sourceOffsetBeats: number, timeline: TempoTimeline): TakeMedia {
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

/**
 * The beat a clip's media reaches `anchorSeconds` on: the song time its media
 * begins: anchor less source entry, divided by the same bounded source rate
 * playback consumes. Across a constant span this is plain beat arithmetic.
 */
function beatAtClipMediaSeconds(
    clip: Clip,
    anchorSeconds: number,
    timeline: TempoTimeline,
    sourceRate: number
): number {
    const entrySeconds = clipEntrySeconds(timeline, clip.startBeat, clip.audioOffsetBeats ?? 0);
    const constantTempoBeat =
        clip.startBeat + ((anchorSeconds - entrySeconds) * timeline.tempoAtBeat(clip.startBeat)) / (60 * sourceRate);
    if (isTempoConstantBetween(timeline, clip.startBeat, constantTempoBeat)) {
        return constantTempoBeat;
    }
    return timeline.beatAtSeconds(timeline.secondsAtBeat(clip.startBeat) + (anchorSeconds - entrySeconds) / sourceRate);
}

/**
 * A placed audio pass: it starts on the beat its clip's media reaches
 * `passAnchorSeconds`, and a fragment at a later beat seeks `passDepthSeconds`
 * plus the source time consumed since, converted at that beat's tempo.
 * The exclusive source end bounds each fragment at its actual source entry and
 * playback rate, including entries rounded by the constant-tempo shortcut.
 */
function placedPassMedia(
    clip: Clip,
    anchorSeconds: number,
    depthSeconds: number,
    sourceEndSeconds: number | undefined,
    timeline: TempoTimeline
): TakeMedia {
    const sourceRate = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const passStartBeat = beatAtClipMediaSeconds(clip, anchorSeconds, timeline, sourceRate);
    const passStartTempo = timeline.tempoAtBeat(passStartBeat);
    const depthBeats = (depthSeconds * passStartTempo) / 60;
    const media: TakeMedia = {
        earliestBeat: Math.max(clip.startBeat, passStartBeat),
        sourceStartBeat: passStartBeat - depthBeats / sourceRate,
        offsetAt: (beat) => {
            if (isTempoConstantBetween(timeline, passStartBeat, beat)) {
                return depthBeats + (beat - passStartBeat) * sourceRate;
            }
            const mediaSeconds =
                depthSeconds + (timeline.secondsAtBeat(beat) - timeline.secondsAtBeat(passStartBeat)) * sourceRate;
            return (mediaSeconds * timeline.tempoAtBeat(beat)) / 60;
        },
    };
    if (sourceEndSeconds !== undefined) {
        const passEndBeat = timeline.beatAtSeconds(
            timeline.secondsAtBeat(passStartBeat) + (sourceEndSeconds - depthSeconds) / sourceRate
        );
        media.latestBeatAt = (beat) => {
            const entrySeconds = clipEntrySeconds(timeline, beat, media.offsetAt(beat));
            const remainingSourceSeconds = sourceEndSeconds - entrySeconds;
            if (remainingSourceSeconds <= 0) {
                return beat;
            }
            const fragmentEndBeat = timeline.beatAtSeconds(
                timeline.secondsAtBeat(beat) + remainingSourceSeconds / sourceRate
            );
            return Math.min(passEndBeat, fragmentEndBeat);
        };
    }
    return media;
}

/**
 * The media a take plays, as one law for every consumer.
 *
 * A take with no `sourceOffsetBeats` plays its clip's media as the clip places
 * it. A loop pass plays its own material: placed at commit, an audio pass holds
 * where it sounds and what it plays in media seconds, so it follows every edit
 * that moves or slips its clip's content exactly as that content does, across
 * any tempo change. Every other pass keeps main's law.
 *
 * `earliestBeat` bounds every take by its clip's start, so no take sounds
 * outside its clip, and a placed pass never sounds before its own material.
 * `offsetAt(beat)` is written for a reader that converts a fragment's offset at
 * the tempo of the fragment's own first beat.
 */
export function resolveTakeMedia(
    take: Pick<Take, 'sourceOffsetBeats' | 'passAnchorSeconds' | 'passDepthSeconds' | 'passSourceEndSeconds'>,
    clip: Clip,
    timeline: TempoTimeline
): TakeMedia {
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
    return placedPassMedia(clip, take.passAnchorSeconds, take.passDepthSeconds, take.passSourceEndSeconds, timeline);
}
