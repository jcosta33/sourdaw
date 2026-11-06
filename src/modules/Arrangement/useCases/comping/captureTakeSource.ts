import { resolveAudioUnwrappedOffsetSeconds } from '#/utils/audioSourceTime';

import { type Take } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';

/** Freeze the take's physical basis before its clip source is rebased. */
export function captureTakeSource(take: Take, clip: Clip | undefined, timeline: TempoTimeline): Take {
    if (clip?.type !== 'audio') {
        return take;
    }
    const tempo = timeline.tempoAtBeat(clip.startBeat);
    if (take.passAnchorSeconds !== undefined && take.passDepthSeconds !== undefined) {
        if (take.passOriginBeat !== undefined && take.passOriginSourceSeconds !== undefined) {
            return take;
        }
        return {
            ...take,
            passOriginBeat: clip.startBeat,
            passOriginSourceSeconds: resolveAudioUnwrappedOffsetSeconds(clip, tempo),
        };
    }
    if (take.sourceOffsetBeats === undefined || take.sourceOffsetSeconds !== undefined) {
        return take;
    }
    return { ...take, sourceOffsetSeconds: (take.sourceOffsetBeats * 60) / tempo };
}
