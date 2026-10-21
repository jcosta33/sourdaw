import { resolveAudioLoopStartSeconds, resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';
import { readTempoAtBeat } from '#/modules/Transport/stores';

import { type Clip } from '../../models/Track';

export function audioSourceAfterSlip(
    clip: Pick<
        Clip,
        | 'startBeat'
        | 'audioOffsetSeconds'
        | 'audioOffsetBeats'
        | 'audioLoopStartSeconds'
        | 'loopEnabled'
        | 'loopOriginBeat'
    >,
    offsetBeats: number,
    offsetSeconds?: number
): { audioOffsetSeconds: number; audioOffsetBeats: number; audioLoopStartSeconds?: number } {
    const tempo = readTempoAtBeat({ beat: clip.startBeat });
    const entry = offsetSeconds ?? (offsetBeats * 60) / tempo;
    return {
        ...(clip.loopEnabled
            ? {
                  audioLoopStartSeconds:
                      resolveAudioLoopStartSeconds(clip, tempo) + entry - resolveAudioSourceOffsetSeconds(clip, tempo),
              }
            : {}),
        audioOffsetSeconds: entry,
        audioOffsetBeats: offsetBeats,
    };
}
