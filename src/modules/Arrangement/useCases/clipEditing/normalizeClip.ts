import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type NormalizationMode } from '../../transformers/clipDspTransformers';

import { getClipNormalizationTargetGain } from './getClipNormalizationTargetGain';

export function normalizeClip(clipId: string, mode: NormalizationMode = 'peak', targetDb?: number): boolean {
    const targetGain = getClipNormalizationTargetGain(clipId, mode, targetDb);
    if (targetGain === null) {
        return false;
    }

    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === target.clipId);
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return false;
    }

    if (Object.is(clip.gain, targetGain)) {
        return false;
    }

    return updateClip(target.clipId, (context) => ({ ...context, gain: targetGain }));
}
