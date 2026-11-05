import { decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';
import { type resolveAgentCatalogCandidate } from '#/modules/SampleLibrary/useCases';

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

type CatalogAudioSource = Extract<
    Awaited<ReturnType<typeof resolveAgentCatalogCandidate>>,
    { status: 'resolved' }
>['source'];

/**
 * The buffer a resolved candidate sounds as: a factory candidate's own resident
 * buffer as it is, a file candidate decoded into one the caller alone holds.
 */
export async function readCatalogCandidateBuffer(source: CatalogAudioSource): Promise<AudioBuffer | null> {
    if (source.kind === 'buffer') {
        return source.buffer;
    }
    return decodeCatalogCandidateFile(source.file);
}
