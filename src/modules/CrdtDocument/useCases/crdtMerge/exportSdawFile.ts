import { automergeRepository } from '../../repositories/automergeRepository';
import { encodeSdawFile } from '../sdawFileFormat/encodeSdawFile';

/**
 * Export the current project as an .sdaw binary blob.
 */
export function exportSdawFile(): Blob {
    const bundle = automergeRepository.saveAll();
    const bytes = encodeSdawFile(bundle);
    return new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
}
