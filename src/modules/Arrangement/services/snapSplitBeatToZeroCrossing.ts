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

    // The absolute distance from the clip's start beat, plus its internal audio offset
    const offsetInAudio = (splitBeat - clip.startBeat) + (clip.audioOffsetBeats ?? 0);
    const targetSample = Math.round((offsetInAudio / beatsPerSecond) * sampleRate);

    const snappedSample = findNearestZeroCrossing(buffer.getChannelData(0), targetSample);
    
    // Convert the snapped sample back into a beat offset from the clip's start
    const snappedOffsetInAudio = (snappedSample / sampleRate) * beatsPerSecond;
    const snappedRelativeBeat = snappedOffsetInAudio - (clip.audioOffsetBeats ?? 0);

    return clip.startBeat + snappedRelativeBeat;
}
