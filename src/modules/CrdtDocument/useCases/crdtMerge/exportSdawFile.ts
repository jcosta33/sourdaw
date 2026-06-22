import { automergeRepository } from '../../repositories/automergeRepository';
import { encodeSdawFile } from '../sdawFileFormat/encodeSdawFile';

/**
 * Export the current project as an .sdaw binary blob.
 */
export function exportSdawFile(): Blob {
    const bundle = automergeRepository.saveAll();
    const bytes = encodeSdawFile(bundle);
    // A `Uint8Array` is an `ArrayBufferView`, which is itself a valid `BlobPart`,
    // so it can be passed to the `Blob` constructor directly — no type assertion
    // is needed. (Passing `bytes.buffer` instead would widen to `ArrayBufferLike`,
    // which includes `SharedArrayBuffer` and is not assignable to `BlobPart`.)
    return new Blob([bytes], { type: 'application/octet-stream' });
}
