import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { removeLibraryRoot } from '../../stores/libraryStore';

/**
 * Disconnect a library root and clear its persisted footprint.
 *
 * {@link removeLibraryRoot} drops the root's in-memory state; this use case then
 * persists that removal so the root's sample rows, root row and directory-handle
 * row are pruned from IndexedDB. Without it the orphaned rows linger and the
 * disconnected root reappears on the next launch. Persistence lives here in a
 * use case — a store never writes to repositories directly.
 */
export async function disconnectLibraryRoot(rootId: string): Promise<void> {
    removeLibraryRoot(rootId);
    await persistSamples();
}
