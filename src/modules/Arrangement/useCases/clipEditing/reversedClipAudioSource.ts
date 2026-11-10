import {
    getAudioSourcePositionSeconds,
    projectAudioLoopPassSegments,
    resolveAudioSourceOffsetSeconds,
} from '#/utils/audioSourceTime';
import { CLIP_LOOP_WINDOW_BEAT_TOLERANCE } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

type ReversibleAudioSource = Pick<
    Clip,
    | 'startBeat'
    | 'endBeat'
    | 'audioOffsetSeconds'
    | 'audioOffsetBeats'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
    | 'stretchMode'
    | 'stretchRatio'
    | 'loopEnabled'
    | 'loopLength'
    | 'loopOriginBeat'
>;

export type ReversedAudioSourceFields = Pick<
    Clip,
    | 'audioOffsetSeconds'
    | 'audioUnwrappedOffsetSeconds'
    | 'audioLoopStartSeconds'
    | 'audioLoopPassEntrySeconds'
    | 'audioLoopPassOriginBeat'
>;

/**
 * The canonical counterpart of `reversedClipAudioOffsetBeats`. The readers
 * play `[E, X)`, where `X` is the source second they reach at the clip end
 * through the tempo map at the stretch rate; after the whole buffer of `D`
 * seconds is mirrored that passage lives at `[D − X, D − E)`, so the entry
 * becomes `D − X`, an involution while span, map and rate hold. The mirrored
 * buffer is a fresh media basis whose repeat grid opens at the mirrored head
 * (the loop law `reverseClip` restamps its anchor by), so each provenance
 * field present restamps to the fresh-region value; an absent one stays
 * absent, since readers already default it to that value.
 *
 * `undefined` for a beat-only clip, whose legacy offset remap stays the only
 * authority; `null` when a canonical entry cannot be mirrored.
 */
export function reversedClipAudioSource(
    clip: ReversibleAudioSource,
    bufferDurationSeconds: number,
    secondsAtBeat: (beat: number) => number,
    tempoAtClipStart: number
): ReversedAudioSourceFields | null | undefined {
    if (!Number.isFinite(bufferDurationSeconds) || bufferDurationSeconds <= 0) {
        return null;
    }
    if (clip.loopEnabled) {
        const sourceEntry = resolveAudioSourceOffsetSeconds(clip, tempoAtClipStart);
        const duration = clip.endBeat - clip.startBeat;
        const { loopLengthBeats } = projectClipLoopExpansion({
            clipDurationBeats: duration,
            configuredLoopLengthBeats: clip.loopLength,
            loopEnabled: true,
        });
        function isLinearPeriod(start: number): boolean {
            const segments = projectAudioLoopPassSegments({
                clip,
                loopLengthBeats,
                iterationStartBeat: start,
                iterationEndBeat: start + loopLengthBeats,
                stretchRatio: consumedStretchFactor(clip),
                tempoAtClipStart,
                secondsAtBeat,
            });
            return (
                segments.length > 0 &&
                segments.every(
                    (segment) =>
                        segment.sourceStartSeconds ===
                        getAudioSourcePositionSeconds(
                            sourceEntry,
                            secondsAtBeat(start + segment.startOffsetBeats) - secondsAtBeat(start),
                            consumedStretchFactor(clip)
                        )
                )
            );
        }
        // A partial mirror may play today's span correctly while moving its
        // preserved loop window beyond the buffer. Admit a complete linear
        // period whose next period repeats the same source entry instead.
        if (
            Math.abs(duration - loopLengthBeats) > CLIP_LOOP_WINDOW_BEAT_TOLERANCE ||
            !isLinearPeriod(clip.startBeat) ||
            !isLinearPeriod(clip.startBeat + loopLengthBeats)
        ) {
            return null;
        }
    }
    if (clip.audioOffsetSeconds === undefined) {
        return undefined;
    }
    const exitSeconds = getAudioSourcePositionSeconds(
        clip.audioOffsetSeconds,
        secondsAtBeat(clip.endBeat) - secondsAtBeat(clip.startBeat),
        consumedStretchFactor(clip)
    );
    const entrySeconds = bufferDurationSeconds - exitSeconds;
    if (!Number.isFinite(entrySeconds)) {
        return null;
    }
    const fields: ReversedAudioSourceFields = { audioOffsetSeconds: entrySeconds };
    if (clip.audioUnwrappedOffsetSeconds !== undefined) {
        fields.audioUnwrappedOffsetSeconds = entrySeconds;
    }
    if (clip.audioLoopStartSeconds !== undefined) {
        fields.audioLoopStartSeconds = entrySeconds;
    }
    if (clip.audioLoopPassEntrySeconds !== undefined) {
        fields.audioLoopPassEntrySeconds = entrySeconds;
    }
    if (clip.audioLoopPassOriginBeat !== undefined) {
        fields.audioLoopPassOriginBeat = clip.startBeat;
    }
    return fields;
}
