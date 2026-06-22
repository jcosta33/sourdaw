import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { libraryStore, removeLibraryRoot, updateLibraryRootStatus } from '../../stores/libraryStore';

import { scanBrowserDirectory, scanTauriDirectory } from './helpers';

/**
 * Rescan a library root — re-traverse and reconcile.
 *
 * The scan helpers reconcile the store against the live file set (removing
 * deleted files, replacing edited ones), so a rescan now reflects on-disk
 * deletions and modifications, not just additions.
 */
export async function rescanRoot(rootId: string): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    const root = state.roots.find((r) => r.id === rootId);
    if (!root) {
        return;
    }

    updateLibraryRootStatus(rootId, 'scanning');

    if (root.provider === 'browser' && root.handle) {
        await scanBrowserDirectory(root);
    } else if (root.provider === 'tauri') {
        await scanTauriDirectory(root);
    }
}

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
