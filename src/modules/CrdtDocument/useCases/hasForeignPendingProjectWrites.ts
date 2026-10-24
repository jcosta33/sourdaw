import { hasForeignPendingAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

/** A saved replay cannot capture projected owners while another root write is unpublished. */
export function hasForeignPendingProjectWrites(): boolean {
    return hasForeignPendingAutomergeStorageWrites(DOC_PREFIX_ROOT);
}
