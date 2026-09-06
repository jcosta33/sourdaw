import { audioBufferCache } from '../stores/audioBufferCache';

export function discardDecodedAudioFile(bufferId: string): void {
    audioBufferCache.remove(bufferId);
}
