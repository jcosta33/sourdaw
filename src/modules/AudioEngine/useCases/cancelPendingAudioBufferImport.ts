import { audioBufferCache } from '../stores/audioBufferCache';

export function cancelPendingAudioBufferImport(): void {
    audioBufferCache.cancelPendingImport();
}
