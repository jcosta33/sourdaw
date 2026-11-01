import { resolveAudioUnwrappedOffsetSeconds } from '#/utils/audioSourceTime';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';

/** The public slip coordinate is absolute media beats under the current clip-start tempo. */
export function audioClipSlipOffsetBeats(clip: Clip, timeline: TempoTimeline): number {
    const tempo = timeline.tempoAtBeat(clip.startBeat);
    return (resolveAudioUnwrappedOffsetSeconds(clip, tempo) * tempo) / 60;
}
