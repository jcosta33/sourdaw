import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { restoreLibrary as restoreLibraryFromRepo } from '../repositories/libraryPersistence/restoreLibrary';

import { buildFolderTree } from './buildFolderTree';

/**
 * Restore library roots and sample metadata from IndexedDB on app launch.
 *
 * The repository reads IDB and rehydrates the store, then this use case drives
 * the folder-tree rebuild for each restored root — keeping the layer direction
 * one-way (a use case orchestrates the repository, never the reverse).
 */
export async function restoreLibrary(): Promise<void> {
    const restoredRootIds = await restoreLibraryFromRepo({ trustedAnalysisRootId: FACTORY_LIBRARY_ROOT_ID });
    for (const rootId of restoredRootIds) {
        buildFolderTree(rootId);
    }
}
