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
