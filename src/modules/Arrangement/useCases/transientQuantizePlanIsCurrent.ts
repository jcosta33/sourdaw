import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { type TransientQuantizePlanSnapshot } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { getTrackState } from '../repositories/track/getTrackState';

import { captureLiveTempoSourceClock } from './clipEditing/captureLiveTempoSourceClock';

/**
 * Whether a carried transient quantize plan still describes this project: the decoded source it was
 * detected in is the same buffer, the tempo clock it placed slices with is unchanged, and the clip
 * it cuts is exactly the one it captured. The detector never runs again; a plan that fails here is
 * refused, never replanned.
 */
export function transientQuantizePlanIsCurrent(clipId: string, plan: TransientQuantizePlanSnapshot): boolean {
    const [expectedClip] = plan.expected.clips;
    if (plan.expected.clips.length !== 1 || expectedClip?.id !== clipId) {
        return false;
    }
    const liveClip = getTrackState()
        ?.tracks.find((track) => track.id === plan.expected.trackId)
        ?.clips.find((clip) => clip.id === clipId);
    if (!liveClip || !jsonValuesEqual(liveClip, expectedClip) || liveClip.audioBufferId !== plan.source.audioBufferId) {
        return false;
    }
    const buffer = getCachedAudioBuffer({ bufferId: plan.source.audioBufferId });
    return (
        buffer !== null &&
        buffer.sampleRate === plan.source.sampleRate &&
        buffer.length === plan.source.length &&
        jsonValuesEqual(captureLiveTempoSourceClock(), plan.clock)
    );
}
