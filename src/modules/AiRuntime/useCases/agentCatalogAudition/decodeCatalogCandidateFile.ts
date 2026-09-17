import { decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';

/**
 * Decode a catalog file into a buffer the caller alone holds, or null.
 *
 * `decodeAudioFileBuffer` assigns no project identity and caches nothing, which
 * is what keeps an audition out of the shared buffer space. A codec the runtime
 * cannot read is an ordinary outcome for a user library, so it is reported as an
 * absent buffer rather than thrown.
 */
export async function decodeCatalogCandidateFile(file: File): Promise<AudioBuffer | null> {
    try {
        return await decodeAudioFileBuffer(file);
    } catch {
        return null;
    }
}
