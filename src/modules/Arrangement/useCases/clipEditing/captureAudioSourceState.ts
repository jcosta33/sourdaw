import { type AudioSourceStateSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';

export function captureAudioSourceState(clip: Clip): AudioSourceStateSnapshot {
    return {
        audioOffsetSeconds: Object.hasOwn(clip, 'audioOffsetSeconds') ? (clip.audioOffsetSeconds ?? null) : null,
        audioOffsetBeats: Object.hasOwn(clip, 'audioOffsetBeats') ? (clip.audioOffsetBeats ?? null) : null,
    };
}
