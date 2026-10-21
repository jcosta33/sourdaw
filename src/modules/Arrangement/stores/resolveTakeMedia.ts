import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';
import {
    getAudioSourcePositionSeconds,
    getAudioTimelineElapsedSeconds,
    resolveAudioSourceOffsetSeconds,
    resolveAudioLoopStartSeconds,
    projectAudioLoopPassSegments,
} from '#/utils/audioSourceTime';
import { boundStretchRatio } from '#/utils/stretchRatioBound';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Take } from '../models/TakeLane';
import { isTempoConstantBetween, type TempoTimeline } from '../models/TempoTimeline';
import { type Clip } from '../models/Track';

type TakeMedia = {
    earliestBeat: number;
    /** Carries the loop-occurrence count for probability rolls, never an audio seek. */
    sourceStartBeat: number;
    /** Compatibility offset, read at the fragment's start tempo. */
    offsetAt: (beat: number) => number;
    /** The fragment enters its source at this beat, with canonical audio seconds. */
    clipAt: (beat: number) => Clip;
};

/**
 * One media law for live playback and export. Canonical audio entry is `a` and
 * effective stretch is `r`: source at beat b is a + r * (S(b) - S(clip.start)).
 * A placed pass starts where that source reaches P, and reads a - P + D plus
 * the same elapsed source time. Its legacy depth is not added a second time.
 * MIDI retains its beat-domain offsets and loop-occurrence origin.
 */
export function resolveTakeMedia(
    take: Pick<Take, 'sourceOffsetBeats' | 'sourceOffsetSeconds' | 'passAnchorSeconds' | 'passDepthSeconds'>,
    clip: Clip,
    timeline: TempoTimeline
): TakeMedia {
    const depthBeats = take.sourceOffsetBeats ?? 0;
    if (clip.type !== 'audio') {
        const offsetAt = (beat: number) => (clip.midiOffsetBeats ?? 0) + (beat - (clip.startBeat - depthBeats));
        return {
            earliestBeat: clip.startBeat,
            sourceStartBeat:
                resolveLoopAnchoredStartBeat({
                    startBeat: clip.startBeat,
                    loopOriginBeat: clip.loopOriginBeat,
                    loopEnabled: clip.loopEnabled ?? false,
                }) - depthBeats,
            offsetAt,
            clipAt: (beat) => {
                const offset = offsetAt(beat);
                return offset === (clip.midiOffsetBeats ?? 0) ? clip : { ...clip, midiOffsetBeats: offset };
            },
        };
    }

    const tempo = timeline.tempoAtBeat(clip.startBeat);
    const entrySeconds = resolveAudioSourceOffsetSeconds(clip, tempo);
    const rate = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const startSeconds = timeline.secondsAtBeat(clip.startBeat);
    const anchor = take.passAnchorSeconds;
    const depth = take.passDepthSeconds;
    const placed = anchor !== undefined && depth !== undefined;
    const legacyDepthSeconds = resolveAudioSourceOffsetSeconds(
        { audioOffsetSeconds: take.sourceOffsetSeconds, audioOffsetBeats: take.sourceOffsetBeats },
        tempo
    );
    const sourceEntrySeconds = placed ? entrySeconds - anchor + depth : entrySeconds + legacyDepthSeconds;
    let passStartBeat = clip.startBeat;
    let sourceStartBeat = clip.startBeat - depthBeats;
    if (placed) {
        passStartBeat = timeline.beatAtSeconds(
            startSeconds + getAudioTimelineElapsedSeconds(entrySeconds, anchor, rate)
        );
        sourceStartBeat = passStartBeat - (depth * timeline.tempoAtBeat(passStartBeat)) / 60;
    }
    const carrier = !placed && legacyDepthSeconds === 0;
    const sourceAt = (beat: number) => {
        if (carrier && clip.loopEnabled && beat >= clip.startBeat) {
            const loop = projectClipLoopExpansion({
                clipDurationBeats: clip.endBeat - clip.startBeat,
                configuredLoopLengthBeats: clip.loopLength,
                loopEnabled: true,
            });
            const iterationStartBeat =
                clip.startBeat + Math.floor((beat - clip.startBeat) / loop.loopLengthBeats) * loop.loopLengthBeats;
            const segments = projectAudioLoopPassSegments({
                clip,
                loopLengthBeats: loop.loopLengthBeats,
                iterationStartBeat,
                iterationEndBeat: iterationStartBeat + loop.loopLengthBeats,
                stretchRatio: rate,
                tempoAtClipStart: tempo,
                secondsAtBeat: timeline.secondsAtBeat,
            });
            const segment = segments.find((item) => beat < iterationStartBeat + item.endOffsetBeats) ?? segments.at(-1);
            if (segment) {
                return getAudioSourcePositionSeconds(
                    segment.sourceStartSeconds,
                    timeline.secondsAtBeat(beat) -
                        timeline.secondsAtBeat(iterationStartBeat + segment.startOffsetBeats),
                    rate
                );
            }
        }
        return getAudioSourcePositionSeconds(sourceEntrySeconds, timeline.secondsAtBeat(beat) - startSeconds, rate);
    };
    const offsetAt = (beat: number): number => {
        // Keep exact legacy beat arithmetic where it expresses the same source.
        if (
            !placed &&
            clip.audioOffsetSeconds === undefined &&
            take.sourceOffsetSeconds === undefined &&
            rate === 1 &&
            isTempoConstantBetween(timeline, clip.startBeat, beat)
        ) {
            return (clip.audioOffsetBeats ?? 0) + (beat - (clip.startBeat - depthBeats));
        }
        return (sourceAt(beat) * timeline.tempoAtBeat(beat)) / 60;
    };
    return {
        earliestBeat: Math.max(clip.startBeat, passStartBeat),
        sourceStartBeat,
        offsetAt,
        clipAt: (beat) => {
            const offsetSeconds = sourceAt(beat);
            const offsetBeats = offsetAt(beat);
            if (
                !clip.loopEnabled &&
                beat === clip.startBeat &&
                offsetSeconds === entrySeconds &&
                offsetBeats === (clip.audioOffsetBeats ?? 0)
            ) {
                return clip;
            }
            const fragment = { ...clip, audioOffsetBeats: offsetBeats, audioOffsetSeconds: offsetSeconds };
            if (carrier && clip.loopEnabled) {
                fragment.audioLoopStartSeconds = resolveAudioLoopStartSeconds(clip, tempo);
                fragment.loopOriginBeat = clip.loopOriginBeat ?? clip.startBeat;
            } else if (!carrier) {
                delete fragment.loopOriginBeat;
                delete fragment.audioLoopStartSeconds;
            }
            return fragment;
        },
    };
}
