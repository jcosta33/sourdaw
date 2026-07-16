import { type Clip } from '../models/Track';
import { findNearestZeroCrossing } from '../transformers/clipDspTransformers';

export type SnapSplitBeatToZeroCrossingInput = {
    clip: Clip;
    splitBeat: number;
    channelData: Float32Array;
    sampleRate: number;
    tempo: number;
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
}: SnapSplitBeatToZeroCrossingInput): number {
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return splitBeat;
    }

    const beatsPerSecond = tempo / 60;

    // The absolute distance from the clip's start beat, plus its internal audio offset
    const offsetInAudio = splitBeat - clip.startBeat + (clip.audioOffsetBeats ?? 0);
    const targetSample = Math.round((offsetInAudio / beatsPerSecond) * sampleRate);

    const snappedSample = findNearestZeroCrossing(channelData, targetSample);

    // Convert the snapped sample back into a beat offset from the clip's start
    const snappedOffsetInAudio = (snappedSample / sampleRate) * beatsPerSecond;
    const snappedRelativeBeat = snappedOffsetInAudio - (clip.audioOffsetBeats ?? 0);

    return clip.startBeat + snappedRelativeBeat;
}
