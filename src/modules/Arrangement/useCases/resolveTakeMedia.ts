import {
    getAudioSourcePositionSeconds,
    getAudioTimelineElapsedSeconds,
    resolveAudioSourceOffsetSeconds,
} from '#/utils/audioSourceTime';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import { type Take } from '../models/TakeLane';
import { isTempoConstantBetween, type TempoTimeline } from '../models/TempoTimeline';
import { type Clip } from '../stores/trackStore';

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
            sourceStartBeat: clip.startBeat - depthBeats,
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
    const sourceAt = (beat: number) =>
        getAudioSourcePositionSeconds(sourceEntrySeconds, timeline.secondsAtBeat(beat) - startSeconds, rate);
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
                beat === clip.startBeat &&
                offsetSeconds === entrySeconds &&
                offsetBeats === (clip.audioOffsetBeats ?? 0)
            ) {
                return clip;
            }
            return { ...clip, audioOffsetBeats: offsetBeats, audioOffsetSeconds: offsetSeconds };
        },
    };
}
