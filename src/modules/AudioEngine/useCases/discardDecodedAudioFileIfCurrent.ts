import { audioBufferCache } from '../stores/audioBufferCache';

/** Discard decoded PCM only while the cache still holds the exact object the caller decoded. */
export function discardDecodedAudioFileIfCurrent(bufferId: string, buffer: AudioBuffer): void {
    if (audioBufferCache.get(bufferId) !== buffer) {
        return;
    }
    audioBufferCache.remove(bufferId);
}
