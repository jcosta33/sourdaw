import { audioBufferCache } from '../stores/audioBufferCache';

import { decodeAudioFileBuffer } from './decodeAudioFileBuffer';

/**
 * Decode an audio file from a File object.
 *
 * The decoded buffer is assigned project identity and cached in `audioBufferCache`.
 */
export async function decodeAudioFile(file: File): Promise<{ id: string; buffer: AudioBuffer }> {
    const buffer = await decodeAudioFileBuffer(file);
    const id = `audio-${crypto.randomUUID()}`;
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
