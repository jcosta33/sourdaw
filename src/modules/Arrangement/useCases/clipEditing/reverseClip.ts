import { inject } from '#/infra/di/inject';
import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { audioBufferCache } from '#/modules/AudioEngine';

export const reverseClip = inject({ getTrackState, updateClip })(
    ({ getTrackState, updateClip }) =>
        function reverseClip(clipId: string): void {
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
                const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
                const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
                for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                    const src = buffer.getChannelData(ch);
                    const dst = reversed.getChannelData(ch);
                    for (let i = 0; i < src.length; i++) {
                        dst[i] = src[src.length - 1 - i]!;
                    }
                }
                const newId = `reversed-${clip.audioBufferId}-${Date.now()}`;
                audioBufferCache.set(newId, reversed);
                updateClip(clipId, (c) => ({ ...c, audioBufferId: newId, name: `${c.name} (reversed)` }));
                return;
            }
        }
);
