import { logger } from '#/infra/logger/appLogger';
import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { libraryStore, updateLibraryRootStatus } from '../../stores/libraryStore';
import { rescanFactoryLibrary } from '../factoryLibrary/rescanFactoryLibrary';

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

    // The factory root has no files to traverse: its rescan renders the pack
    // again, caches the samples with no stored audio, and settles its own status.
    if (root.id === FACTORY_LIBRARY_ROOT_ID) {
        try {
            await rescanFactoryLibrary(getAudioContext());
        } catch (error) {
            logger.error(new Error('Factory library reload failed', { cause: error }));
        }
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
