import { libraryStore } from '../../stores/libraryStore';

/**
 * Request permission for a browser directory handle that needs re-authorization.
 */
export async function requestPermission(rootId: string): Promise<boolean> {
    const state = libraryStore.value;
    if (!state) {
        return false;
    }

    const root = state.roots.find((r) => r.id === rootId);
    if (!root || !root.handle) {
        return false;
    }

    try {
        const perm = await (
            root.handle as unknown as { requestPermission: (opts: { mode: string }) => Promise<string> }
        ).requestPermission({ mode: 'read' });
        if (perm === 'granted') {
            const { updateLibraryRootStatus } = await import('../../stores/libraryStore');
            updateLibraryRootStatus(rootId, 'ready');
            return true;
        }
    } catch {
        // Permission denied
    }

    return false;
}
