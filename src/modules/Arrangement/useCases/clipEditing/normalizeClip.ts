import { inject } from '#/infra/di/inject';
import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import {
    computeNormalizationScale,
    type NormalizationMode,
} from '#/modules/Arrangement/transformers/clipDspTransformers';

export const normalizeClip = inject({ getTrackState, updateClip })(
    ({ getTrackState, updateClip }) =>
        function normalizeClip(clipId: string, mode: NormalizationMode = 'peak', targetDb?: number): void {
            const state = getTrackState();
            if (!state) {
                return;
            }
            for (const track of state.tracks) {
                const clip = track.clips.find((c) => c.id === clipId);
                if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
                    continue;
                }
                const buffer = audioBufferCache.get(clip.audioBufferId);
                if (!buffer) {
                    return;
                }

                const scale = computeNormalizationScale(buffer, mode, targetDb);
                if (scale === null) {
                    return;
                }

                updateClip(clipId, (c) => ({ ...c, gain: c.gain * scale }));
                return;
            }
        }
);
