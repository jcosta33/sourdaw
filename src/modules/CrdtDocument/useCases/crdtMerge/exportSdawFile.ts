import { automergeRepository } from '../../repositories/automergeRepository';
import { encodeSdawFile } from '../sdawFileFormat/encodeSdawFile';

/**
 * Export the current project as an .sdaw binary blob.
 */
export function exportSdawFile(): Blob {
    const bundle = automergeRepository.saveAll();
    const bytes = encodeSdawFile(bundle);
    // eslint-disable-next-line sourdaw/no-type-assertion-escape -- Uint8Array<ArrayBufferLike> requires cast to BlobPart; structurally safe at runtime
    return new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
}
