import { type resolveAgentCatalogCandidate } from '#/modules/SampleLibrary/useCases';

import { decodeCatalogCandidateFile } from './decodeCatalogCandidateFile';

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
