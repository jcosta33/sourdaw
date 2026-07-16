import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { snapSplitBeatToZeroCrossing as snapSplitBeatToZeroCrossingService } from '../../services/snapSplitBeatToZeroCrossing';
import { type Clip } from '../../stores/trackStore';

export function snapToZeroCrossing(clip: Clip, beat: number): number {
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return beat;
    }

    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return beat;
    }

    return snapSplitBeatToZeroCrossingService({
        clip,
        splitBeat: beat,
        channelData: buffer.getChannelData(0),
        sampleRate: buffer.sampleRate,
        tempo: transportStore.value?.tempo ?? 120,
    });
}
