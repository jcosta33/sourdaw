import { libraryStore } from '../../stores/libraryStore';

import { HANDLES_STORE, ROOTS_STORE, openDb } from './helpers';

/**
 * Persist all current library roots to IndexedDB.
 */
export async function persistLibraryRoots(): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    try {
        const db = await openDb();
        const tx = db.transaction([ROOTS_STORE, HANDLES_STORE], 'readwrite');
        const rootStore = tx.objectStore(ROOTS_STORE);
        const handleStore = tx.objectStore(HANDLES_STORE);

        for (const root of state.roots) {
            // Serialize root without the handle (handles can't be JSON-stringified)
            const serializable = { ...root, handle: undefined };
            rootStore.put(serializable);

            // Persist browser directory handles separately
            if (root.provider === 'browser' && root.handle) {
                handleStore.put({ id: root.id, handle: root.handle });
            }
        }

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        });
        db.close();
    } catch {
        // Silent fail — persistence is best-effort
    }
}
