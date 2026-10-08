import { resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';

import { consumedStretchFactor } from './consumedStretchFactor';

/** Mirror the source interval that one unlooped clip reads inside the whole reversed buffer. */
export function reversedClipAudioSource(input: {
    audioOffsetSeconds?: number;
    audioOffsetBeats?: number;
    elapsedTimelineSeconds: number;
    bufferLength: number;
    sampleRate: number;
    tempo: number;
    stretchMode?: string;
    stretchRatio?: number;
}): { audioOffsetSeconds: number; audioOffsetBeats: number } | undefined {
    const { elapsedTimelineSeconds, bufferLength, sampleRate, tempo } = input;
    if (!Number.isFinite(elapsedTimelineSeconds) || elapsedTimelineSeconds < 0) {
        return undefined;
    }
    if (!Number.isFinite(bufferLength) || bufferLength <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        return undefined;
    }
    if (!Number.isFinite(tempo) || tempo <= 0) {
        return undefined;
    }

    const sourceEntrySeconds = resolveAudioSourceOffsetSeconds(input, tempo);
    if (!Number.isFinite(sourceEntrySeconds)) {
        return undefined;
    }
    const sourceConsumedSeconds = elapsedTimelineSeconds * consumedStretchFactor(input);
    const audioOffsetSeconds = bufferLength / sampleRate - sourceEntrySeconds - sourceConsumedSeconds;
    if (!Number.isFinite(audioOffsetSeconds)) {
        return undefined;
    }
    return { audioOffsetSeconds, audioOffsetBeats: (audioOffsetSeconds * tempo) / 60 };
}
