import { libraryStore, updateLibraryRootStatus } from '../../stores/libraryStore';
import { scanBrowserDirectory, scanTauriDirectory } from './helpers';

/**
 * Rescan a library root — re-traverse and reconcile.
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