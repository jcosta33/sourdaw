import { automergeRepository } from '../repositories/automergeRepository';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

/**
 * The document paths written to the root document since `heads` (from `captureRootDocumentHeads`),
 * whoever wrote them, merged peers included. Array indexes in a path name the live document's
 * positions. Empty when the root document is gone.
 */
export function readRootPatchPathsSince(heads: readonly string[]): ReadonlyArray<ReadonlyArray<string | number>> {
    return automergeRepository.getPatchPathsSince(DOC_PREFIX_ROOT, [...heads]) ?? [];
}
