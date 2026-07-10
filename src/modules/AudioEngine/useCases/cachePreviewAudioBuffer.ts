import { audioBufferCache } from '../stores/audioBufferCache';

import { getAudioContext } from './engineAccess/getAudioContext';

type CachePreviewAudioBufferInput = {
    audio: Float32Array;
    sampleRate: number;
};

export function cachePreviewAudioBuffer({ audio, sampleRate }: CachePreviewAudioBufferInput): string {
    const buffer_id = `ai-render-${crypto.randomUUID()}`;
    const context = getAudioContext();
    const buffer = context.createBuffer(1, audio.length, sampleRate);
    buffer.getChannelData(0).set(audio);
    audioBufferCache.set(buffer_id, buffer);
    return buffer_id;
}
