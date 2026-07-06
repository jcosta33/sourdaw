import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';

export function reverseClip(clipId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }
    for (const track of state.tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
        if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
            continue;
        }
        const buffer = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
        if (!buffer) {
            return;
        }
        const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const src = buffer.getChannelData(ch);
            const dst = reversed.getChannelData(ch);
            for (let index = 0; index < src.length; index++) {
                dst[index] = src[src.length - 1 - index]!;
            }
        }
        const newId = `reversed-${clip.audioBufferId}-${Date.now()}`;
        cacheAudioBuffer({ buffer: reversed, bufferId: newId });
        updateClip(clipId, (context) => ({ ...context, audioBufferId: newId, name: `${context.name} (reversed)` }));
        return;
    }
}
