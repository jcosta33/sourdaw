import { audioBufferCache } from '../stores/audioBufferCache';
import { type AudioBufferResidencyHold } from '../stores/audioBufferResidencyHolds';

import { decodeAudioFileBuffer } from './decodeAudioFileBuffer';

/**
 * Decode an audio file from a File object.
 *
 * The decoded buffer is assigned project identity and cached in `audioBufferCache`.
 * A caller that places the buffer later passes its hold, which retains the new
 * id before the cache write so the buffer survives until the caller's owner
 * references it.
 */
export async function decodeAudioFile(
    file: File,
    hold?: AudioBufferResidencyHold
): Promise<{ id: string; buffer: AudioBuffer }> {
    const buffer = await decodeAudioFileBuffer(file);
    const id = `audio-${crypto.randomUUID()}`;
    hold?.retain(id);
    audioBufferCache.set(id, buffer);
    return { id, buffer };
}
