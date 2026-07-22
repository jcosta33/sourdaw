import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { computeNormalizationScale, type NormalizationMode } from '../../transformers/clipDspTransformers';

export function normalizeClip(clipId: string, mode: NormalizationMode = 'peak', targetDb?: number): boolean {
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

    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return false;
    }

    const scale = computeNormalizationScale(buffer, mode, targetDb);
    if (scale === null) {
        return false;
    }

    return updateClip(target.clipId, (context) => ({ ...context, gain: context.gain * scale }));
}
