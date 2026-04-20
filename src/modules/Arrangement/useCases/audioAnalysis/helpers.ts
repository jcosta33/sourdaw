import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { trackStore } from '../../stores/trackStore';

export function getBufferForClip(clipId: string): { buffer: AudioBuffer; audioBufferId: string } | null {
    const track = trackStore.value?.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (!track) {
        return null;
    }
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip || clip.type !== 'audio' || !clip.audioBufferId) {
        return null;
    }
    const buffer = audioBufferCache.get(clip.audioBufferId);
    if (!buffer) {
        return null;
    }
    return { buffer, audioBufferId: clip.audioBufferId };
}
