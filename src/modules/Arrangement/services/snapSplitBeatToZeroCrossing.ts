import {
    getAudioSourcePositionSeconds,
    getAudioTimelineElapsedSeconds,
    projectAudioLoopPassSegments,
} from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../models/Track';
import { type TempoTimeline } from '../models/TempoTimeline';
import { findNearestZeroCrossing } from '../transformers/clipDspTransformers';

export type SnapSplitBeatToZeroCrossingInput = {
    clip: Clip;
    splitBeat: number;
    channelData: Float32Array;
    sampleRate: number;
    timeline: TempoTimeline;
    stretchRatio: number;
};

export type ZeroCrossingPosition = {
    beat: number;
    sourceSeconds?: number;
};

/**
 * Given a clip and a proposed split beat, snaps the split position
 * to the nearest zero crossing in the audio data to avoid clicks.
 * Returns the original splitBeat unchanged for non-audio clips.
 */
export function snapSplitBeatToZeroCrossing(input: SnapSplitBeatToZeroCrossingInput): number {
    return snapSplitPositionToZeroCrossing(input).beat;
}

/** Retain the selected physical sample instead of reconstructing it from the inverse beat. */
export function snapSplitPositionToZeroCrossing({
    clip,
    splitBeat,
    channelData,
    sampleRate,
    timeline,
    stretchRatio,
}: SnapSplitBeatToZeroCrossingInput): ZeroCrossingPosition {
    if (
        clip.type !== 'audio' ||
        !clip.audioBufferId ||
        !Number.isFinite(splitBeat) ||
        splitBeat < clip.startBeat ||
        !Number.isFinite(sampleRate) ||
        sampleRate <= 0 ||
        !Number.isFinite(stretchRatio) ||
        stretchRatio <= 0 ||
        channelData.length < 2
    ) {
        return { beat: splitBeat };
    }

    const splitSeconds = timeline.secondsAtBeat(splitBeat);
    // Include rounding slack around the finder's 256-sample search window.
    const searchSeconds = 257 / (sampleRate * stretchRatio);
    const windowStartBeat = Math.max(clip.startBeat, timeline.beatAtSeconds(splitSeconds - searchSeconds));
    const windowEndBeat = timeline.beatAtSeconds(splitSeconds + searchSeconds);
    if (!Number.isFinite(windowStartBeat) || !Number.isFinite(windowEndBeat)) {
        return { beat: splitBeat };
    }

    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const part = projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: loop.loopLengthBeats,
        iterationStartBeat: windowStartBeat,
        iterationEndBeat: windowEndBeat,
        stretchRatio,
        tempoAtClipStart: timeline.tempoAtBeat(clip.startBeat),
        secondsAtBeat: timeline.secondsAtBeat,
    }).find(
        (candidate) =>
            windowStartBeat + candidate.startOffsetBeats <= splitBeat &&
            splitBeat < windowStartBeat + candidate.endOffsetBeats
    );
    if (!part) {
        return { beat: splitBeat };
    }

    const partStartBeat = windowStartBeat + part.startOffsetBeats;
    const partEndBeat = windowStartBeat + part.endOffsetBeats;
    const partStartSeconds = timeline.secondsAtBeat(partStartBeat);
    const sourceSeconds = getAudioSourcePositionSeconds(
        part.sourceStartSeconds,
        splitSeconds - partStartSeconds,
        stretchRatio
    );
    if (!Number.isFinite(sourceSeconds) || sourceSeconds < 0 || sourceSeconds >= channelData.length / sampleRate) {
        return { beat: splitBeat };
    }

    const sourceEndSeconds = getAudioSourcePositionSeconds(
        part.sourceStartSeconds,
        timeline.secondsAtBeat(partEndBeat) - partStartSeconds,
        stretchRatio
    );
    // Both samples of the sign pair must belong to this occurrence and its finite media.
    const firstSample = Math.max(0, Math.ceil(part.sourceStartSeconds * sampleRate));
    const endSample = Math.min(channelData.length, Math.ceil(sourceEndSeconds * sampleRate));
    const samples = channelData.subarray(firstSample, endSample);
    const targetSample = Math.round(sourceSeconds * sampleRate) - firstSample;
    const snappedSample = findNearestZeroCrossing(samples, targetSample);
    if (
        snappedSample < 0 ||
        snappedSample >= samples.length - 1 ||
        !(samples[snappedSample]! * samples[snappedSample + 1]! <= 0)
    ) {
        return { beat: splitBeat };
    }

    const snappedBeat = timeline.beatAtSeconds(
        partStartSeconds +
            getAudioTimelineElapsedSeconds(
                part.sourceStartSeconds,
                (firstSample + snappedSample) / sampleRate,
                stretchRatio
            )
    );
    return Number.isFinite(snappedBeat) && partStartBeat <= snappedBeat && snappedBeat < partEndBeat
        ? { beat: snappedBeat, sourceSeconds: (firstSample + snappedSample) / sampleRate }
        : { beat: splitBeat };
}
