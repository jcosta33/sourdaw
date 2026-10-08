import { readSecondsAtBeat, readTempoAtBeat } from '#/modules/Transport/stores';
import { getAudioSourcePositionSeconds, resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';

import { type Clip } from '../../models/Track';

import { consumedStretchFactor } from './consumedStretchFactor';

export function audioSourceAtBeat(clip: Clip, beat: number): { audioOffsetSeconds: number; audioOffsetBeats: number } {
    const sourceSeconds = getAudioSourcePositionSeconds(
        resolveAudioSourceOffsetSeconds(clip, readTempoAtBeat({ beat: clip.startBeat })),
        readSecondsAtBeat({ beat }) - readSecondsAtBeat({ beat: clip.startBeat }),
        consumedStretchFactor(clip)
    );
    return {
        audioOffsetSeconds: sourceSeconds,
        audioOffsetBeats: (sourceSeconds * readTempoAtBeat({ beat })) / 60,
    };
}
