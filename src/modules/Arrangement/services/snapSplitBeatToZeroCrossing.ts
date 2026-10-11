import {
    getAudioSourcePositionSeconds,
    getAudioTimelineElapsedSeconds,
    resolveAudioSourceOffsetSeconds,
} from '#/utils/audioSourceTime';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { boundStretchRatio } from '#/utils/stretchRatioBound';

import { type Clip } from '../models/Track';
import { findNearestZeroCrossing } from '../transformers/clipDspTransformers';

export type SnapSplitBeatToZeroCrossingInput = {
    clip: Clip;
    splitBeat: number;
    channelData: Float32Array;
    sampleRate: number;
    tempo: number;
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
};

/**
 * Given a clip and a proposed split beat, snaps the split position
 * to the nearest zero crossing in the audio data to avoid clicks.
 * Returns the original splitBeat unchanged for non-audio clips.
 */
export function snapSplitBeatToZeroCrossing({
    clip,
    splitBeat,
    channelData,
    sampleRate,
    tempo,
    secondsAtBeat,
    beatAtSeconds,
}: SnapSplitBeatToZeroCrossingInput): number {
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return splitBeat;
    }

    const loop = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const iteration = Math.max(0, Math.floor((splitBeat - clip.startBeat) / loop.loopLengthBeats));
    const iterationStartBeat = clip.startBeat + iteration * loop.loopLengthBeats;
    const iterationEndBeat = Math.min(clip.endBeat, iterationStartBeat + loop.loopLengthBeats);
    if (iteration >= loop.iterationCount || splitBeat <= iterationStartBeat || splitBeat >= iterationEndBeat) {
        return splitBeat;
    }
    const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const sourceOffsetSeconds = resolveAudioSourceOffsetSeconds(clip, tempo);
    const iterationStartSeconds = secondsAtBeat(iterationStartBeat);
    const sourceSeconds = getAudioSourcePositionSeconds(
        sourceOffsetSeconds,
        secondsAtBeat(splitBeat) - iterationStartSeconds,
        stretchRatio
    );
    const targetSample = Math.round(sourceSeconds * sampleRate);
    if (targetSample < 0 || targetSample >= channelData.length - 1) {
        return splitBeat;
    }

    const snappedSample = findNearestZeroCrossing(channelData, targetSample);
    if (channelData[snappedSample]! * channelData[snappedSample + 1]! > 0) {
        return splitBeat;
    }
    const elapsedSeconds = getAudioTimelineElapsedSeconds(
        sourceOffsetSeconds,
        snappedSample / sampleRate,
        stretchRatio
    );
    const snappedBeat = beatAtSeconds(iterationStartSeconds + elapsedSeconds);
    return snappedBeat > iterationStartBeat && snappedBeat < iterationEndBeat ? snappedBeat : splitBeat;
}
