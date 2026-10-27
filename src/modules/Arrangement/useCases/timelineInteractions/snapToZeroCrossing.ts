import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { snapSplitPositionToZeroCrossing, type ZeroCrossingPosition } from '../../services/snapSplitBeatToZeroCrossing';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../stores/trackStore';
import { consumedStretchFactor } from '../clipEditing/consumedStretchFactor';
import { liveTempoTimeline } from '../liveTempoTimeline';

export function snapToZeroCrossing(clip: Clip, beat: number): number {
    return resolveZeroCrossingPosition(clip, beat).beat;
}

export function resolveZeroCrossingPosition(
    clip: Clip,
    beat: number,
    timeline: TempoTimeline = liveTempoTimeline
): ZeroCrossingPosition {
    if (clip.type !== 'audio' || !clip.audioBufferId) {
        return { beat };
    }

    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return { beat };
    }

    return snapSplitPositionToZeroCrossing({
        clip,
        splitBeat: beat,
        channelData: buffer.getChannelData(0),
        sampleRate: buffer.sampleRate,
        timeline,
        stretchRatio: consumedStretchFactor(clip),
    });
}
