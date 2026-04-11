import { restoreLibrary as restoreLibraryFromRepo } from '../repositories/libraryPersistence/restoreLibrary';

/**
 * Restore library roots and sample metadata from IndexedDB on app launch.
 */
export async function restoreLibrary(): Promise<void> {
    return restoreLibraryFromRepo();
}
