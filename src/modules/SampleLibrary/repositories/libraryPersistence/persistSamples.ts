import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { libraryStore } from '../../stores/libraryStore';

import { HANDLES_STORE, ROOTS_STORE, SAMPLES_STORE, openDb } from './helpers';

/**
 * localStorage key under which the session's focused root id is persisted, so a
 * reload can restore the user's last-browsed root instead of resetting focus.
 * Shared with {@link restoreLibrary}.
 */
export const ACTIVE_ROOT_KEY = 'wd:library-active-root';

/**
 * Read every key currently stored in an object store.
 */
function getAllKeys(store: IDBObjectStore): Promise<IDBValidKey[]> {
    return new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB getAllKeys failed'));
    });
}

/**
 * Persist sample records and reconcile IndexedDB against the in-memory store.
 *
 * This is a reconcile, not a put-only write: every persisted row whose id is no
 * longer present in the store is deleted. That evicts samples whose backing
 * files disappeared on rescan, the sample rows of a disconnected root, and the
 * root/handle rows of a removed root — none of which a put-only loop could ever
 * clear, so they previously lingered forever and a removed root reappeared on
 * the next launch.
 */
export async function persistSamples(): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    try {
        const db = await openDb();
        const tx = db.transaction([SAMPLES_STORE, ROOTS_STORE, HANDLES_STORE], 'readwrite');
        const sampleStore = tx.objectStore(SAMPLES_STORE);
        const rootStore = tx.objectStore(ROOTS_STORE);
        const handleStore = tx.objectStore(HANDLES_STORE);

        // Samples: upsert the current set, then prune any persisted id that is
        // no longer in memory.
        const liveSampleIds = new Set(state.samples.map((s) => s.id));
        for (const sample of state.samples) {
            sampleStore.put(sample);
        }
        const persistedSampleKeys = await getAllKeys(sampleStore);
        for (const key of persistedSampleKeys) {
            if (!liveSampleIds.has(key as string)) {
                sampleStore.delete(key);
            }
        }

        // Roots / handles: prune rows for roots that no longer exist. The roots
        // themselves are upserted by persistLibraryRoots; here we only delete
        // the orphans it cannot, so a disconnected root stays disconnected
        // instead of reappearing on the next launch.
        const liveRootIds = new Set(state.roots.map((r) => r.id));
        const persistedRootKeys = await getAllKeys(rootStore);
        for (const key of persistedRootKeys) {
            if (!liveRootIds.has(key as string)) {
                rootStore.delete(key);
            }
        }
        const persistedHandleKeys = await getAllKeys(handleStore);
        for (const key of persistedHandleKeys) {
            if (!liveRootIds.has(key as string)) {
                handleStore.delete(key);
            }
        }

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        });
        db.close();

        // Persist focused root so a reload can restore session focus.
        if (typeof localStorage !== 'undefined') {
            if (state.activeRootId) {
                localStorage.setItem(ACTIVE_ROOT_KEY, state.activeRootId);
            } else {
                localStorage.removeItem(ACTIVE_ROOT_KEY);
            }
        }
    } catch (error) {
        logger.error(error instanceof Error ? error : new Error(String(error)));
        const isQuota = error instanceof DOMException && error.name === 'QuotaExceededError';
        notifyUser(
            isQuota
                ? 'Storage is full — the sample library could not be saved. Free up disk space and try again.'
                : 'Could not save the sample library; your latest changes may be lost on reload.',
            'error'
        );
    }
}
