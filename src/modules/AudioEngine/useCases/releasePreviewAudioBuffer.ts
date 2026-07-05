import { audioBufferCache } from '../stores/audioBufferCache';

export function releasePreviewAudioBuffer(bufferId: string): void {
    audioBufferCache.remove(bufferId);
}
