import { isDesktopRuntime } from '#/utils/desktopBridge';

import { libraryStore, updateLibraryRootStatus } from '../../stores/libraryStore';
import { pickNativeSampleFolder } from '../pickNativeSampleFolder';

/**
 * Re-authorize a root the app can see but may no longer read.
 *
 * The two runtimes lose access for different reasons and regain it different
 * ways. A browser root holds a directory handle whose permission the user can
 * be asked for again. A desktop root holds an absolute path and no handle at
 * all: what it lost is a native file grant (jcosta33/sourdaw#3313), and the
 * only thing that mints one is the user picking the folder in a native dialog.
 * Treating the missing handle as a dead end left every desktop root stuck in
 * `permission_required` with a restore action that could not restore it.
 *
 * The picked path must be the root's own. A different folder is a different
 * root — connecting it is the add-root flow, not this one — so the status is
 * left alone and the user is free to try again.
 */
export async function requestPermission(rootId: string): Promise<boolean> {
    const state = libraryStore.value;
    if (!state) {
        return false;
    }

    const root = state.roots.find((candidate) => candidate.id === rootId);
    if (!root) {
        return false;
    }

    if (root.handle) {
        try {
            const permission = await root.handle.requestPermission({ mode: 'read' });
            if (permission === 'granted') {
                updateLibraryRootStatus(rootId, 'ready');
                return true;
            }
        } catch {
            // Permission denied.
        }
        return false;
    }

    if (!isDesktopRuntime() || root.provider !== 'desktop' || !root.rootRef) {
        return false;
    }

    const picked = await pickNativeSampleFolder();
    if (picked !== root.rootRef) {
        return false;
    }

    updateLibraryRootStatus(rootId, 'ready');
    return true;
}
