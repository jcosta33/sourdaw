import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getTransportState } from '#/modules/Transport/useCases';
import { findNearestZeroCrossing } from '../transformers/clipDspTransformers';
import { type Clip } from '../models/Track';

/**
 * Given a clip and a proposed split beat, snaps the split position
 * to the nearest zero crossing in the audio data to avoid clicks.
 * Returns the original splitBeat unchanged for non-audio clips.
 */
export function snapSplitBeatToZeroCrossing(clip: Clip, splitBeat: number): number {
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return splitBeat;
    }

    const buffer = audioBufferCache.get(clip.audioBufferId);
    if (!buffer) {
        return splitBeat;
    }

    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;
    const sampleRate = buffer.sampleRate;

    const relativeBeat = splitBeat - clip.startBeat;
    const targetSample = Math.round((relativeBeat / beatsPerSecond) * sampleRate);

    const snappedSample = findNearestZeroCrossing(buffer.getChannelData(0), targetSample);
    const snappedRelativeBeat = (snappedSample / sampleRate) * beatsPerSecond;

    return clip.startBeat + snappedRelativeBeat;
}
