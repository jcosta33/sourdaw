import { libraryStore, updateLibraryRootStatus } from '../../stores/libraryStore';

import { scanBrowserDirectory } from './scanBrowserDirectory';
import { scanNativeDirectory } from './scanNativeDirectory';

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

    // Only the two branches below actually run a scanner that clears the
    // 'scanning' status in its finally block. A handle-less browser root
    // (permission_required / offline) matches neither, so flipping the status
    // to 'scanning' up front would strand it on a permanent spinner. Decide
    // which scanner runs first, and only enter the scanning state when one will.
    if (root.provider === 'browser' && root.handle) {
        updateLibraryRootStatus(rootId, 'scanning');
        await scanBrowserDirectory(root);
    } else if (root.provider === 'desktop') {
        updateLibraryRootStatus(rootId, 'scanning');
        await scanNativeDirectory(root);
    }
}
