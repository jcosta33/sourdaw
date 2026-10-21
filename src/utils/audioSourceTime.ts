import { resolveClipLoopOriginAdvance } from './clipLoopOrigin';
import { boundStretchRatio } from './stretchRatioBound';

type AudioSourceOffset = {
    audioOffsetSeconds?: number;
    audioOffsetBeats?: number;
};

/**
 * Source entry is signed: a negative value names silence before sample zero.
 * Canonical seconds, including zero, win over the legacy beat offset. Legacy
 * beats use the flat tempo at the clip's start, never tempo-map integration.
 */
export function resolveAudioSourceOffsetSeconds(offset: AudioSourceOffset, tempoAtClipStart: number): number {
    if (offset.audioOffsetSeconds !== undefined) {
        return offset.audioOffsetSeconds;
    }
    if (!Number.isFinite(tempoAtClipStart) || tempoAtClipStart <= 0) {
        return 0;
    }
    return (offset.audioOffsetBeats ?? 0) * (60 / tempoAtClipStart);
}

/**
 * Callers integrate elapsed timeline seconds through their tempo map and choose
 * the effective stretch ratio (1 when stretch is off). Signed source positions
 * remain unclamped so callers can schedule the silent lead-in correctly.
 */
export function getAudioSourcePositionSeconds(
    sourceOffsetSeconds: number,
    elapsedTimelineSeconds: number,
    stretchRatio: number
): number {
    return sourceOffsetSeconds + boundStretchRatio(stretchRatio) * elapsedTimelineSeconds;
}

/** Inverse source mapping; callers own conversion from elapsed seconds to beats. */
export function getAudioTimelineElapsedSeconds(
    sourceOffsetSeconds: number,
    sourcePositionSeconds: number,
    stretchRatio: number
): number {
    return (sourcePositionSeconds - sourceOffsetSeconds) / boundStretchRatio(stretchRatio);
}

/** Source boundaries and timeline phase are independent after a trim, split or move. */
type LoopedAudioSource = AudioSourceOffset & {
    startBeat: number;
    loopOriginBeat?: number;
    loopEnabled?: boolean;
    audioLoopStartSeconds?: number;
};

/** Legacy clips retain the published beat-region law until an edit captures its seconds. */
export function resolveAudioLoopStartSeconds(clip: LoopedAudioSource, tempoAtClipStart: number): number {
    if (clip.audioLoopStartSeconds !== undefined) {
        return clip.audioLoopStartSeconds;
    }
    const advance = resolveClipLoopOriginAdvance({
        ...clip,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
    });
    return (
        resolveAudioSourceOffsetSeconds(clip, tempoAtClipStart) -
        (Number.isFinite(tempoAtClipStart) && tempoAtClipStart > 0 ? advance * (60 / tempoAtClipStart) : 0)
    );
}

/** The existing bounded pass segmentation, with source seconds and the song's actual clock. */
export function projectAudioLoopPassSegments({
    clip,
    loopLengthBeats,
    iterationStartBeat,
    iterationEndBeat,
    stretchRatio,
    tempoAtClipStart,
    secondsAtBeat,
}: {
    clip: LoopedAudioSource;
    loopLengthBeats: number;
    iterationStartBeat: number;
    iterationEndBeat: number;
    stretchRatio: number;
    tempoAtClipStart: number;
    secondsAtBeat: (beat: number) => number;
}): { startOffsetBeats: number; endOffsetBeats: number; sourceStartSeconds: number }[] {
    const duration = iterationEndBeat - iterationStartBeat;
    if (!(duration > 0)) {
        return [];
    }
    const advance = resolveClipLoopOriginAdvance({
        ...clip,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const phase = ((advance % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
    const sourceStart = resolveAudioSourceOffsetSeconds(clip, tempoAtClipStart);
    if (!clip.loopEnabled) {
        return [{ startOffsetBeats: 0, endOffsetBeats: duration, sourceStartSeconds: sourceStart }];
    }
    const regionStart = resolveAudioLoopStartSeconds(clip, tempoAtClipStart);
    const headSource =
        clip.audioOffsetSeconds === undefined && clip.audioLoopStartSeconds === undefined
            ? regionStart + resolveAudioSourceOffsetSeconds({ audioOffsetBeats: phase }, tempoAtClipStart)
            : clip.audioLoopStartSeconds === undefined || iterationStartBeat === clip.startBeat
              ? sourceStart
              : regionStart +
                boundStretchRatio(stretchRatio) *
                    (secondsAtBeat(iterationStartBeat) - secondsAtBeat(iterationStartBeat - phase));
    const headEnd = Math.min(duration, loopLengthBeats - phase);
    const segments = [{ startOffsetBeats: 0, endOffsetBeats: headEnd, sourceStartSeconds: headSource }];
    if (phase > 0 && duration > headEnd) {
        segments.push({ startOffsetBeats: headEnd, endOffsetBeats: duration, sourceStartSeconds: regionStart });
    }
    return segments;
}
