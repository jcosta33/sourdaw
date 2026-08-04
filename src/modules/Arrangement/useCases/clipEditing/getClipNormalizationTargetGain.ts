import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { computeNormalizationScale, type NormalizationMode } from '../../transformers/clipDspTransformers';

export function getClipNormalizationTargetGain(
    clipId: string,
    mode: NormalizationMode = 'peak',
    targetDb?: number
): number | null {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((candidate) => candidate.id === target.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === target.clipId);
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return null;
    }

    const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    if (!buffer) {
        return null;
    }

    const scale = computeNormalizationScale(buffer, mode, targetDb);
    if (scale === null || !Number.isFinite(scale) || scale <= 0) {
        return null;
    }

    return Math.min(2, scale);
}
