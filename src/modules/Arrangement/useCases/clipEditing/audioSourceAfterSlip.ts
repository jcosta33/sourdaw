import { readTempoAtBeat } from '#/modules/Transport/stores';

import { type Clip } from '../../models/Track';

export function audioSourceAfterSlip(
    clip: Pick<Clip, 'startBeat'>,
    offsetBeats: number,
    offsetSeconds?: number
): { audioOffsetSeconds: number; audioOffsetBeats: number } {
    return {
        audioOffsetSeconds: offsetSeconds ?? (offsetBeats * 60) / readTempoAtBeat({ beat: clip.startBeat }),
        audioOffsetBeats: offsetBeats,
    };
}
