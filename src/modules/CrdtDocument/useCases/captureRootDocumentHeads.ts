import { automergeRepository } from '../repositories/automergeRepository';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

/** The heads of the root document now, for `readRootPatchPathsSince`; empty when it has none. */
export function captureRootDocumentHeads(): string[] {
    const heads = automergeRepository.getHeads(DOC_PREFIX_ROOT);
    return heads ? Array.from(heads) : [];
}
