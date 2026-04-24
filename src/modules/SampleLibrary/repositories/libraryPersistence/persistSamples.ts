import { libraryStore } from '../../stores/libraryStore';

import { SAMPLES_STORE, openDb } from './helpers';

/**
 * Persist sample records in batches.
 */
export async function persistSamples(): Promise<void> {
    const state = libraryStore.value;
    if (!state) {
        return;
    }

    try {
        const db = await openDb();
        const tx = db.transaction(SAMPLES_STORE, 'readwrite');
        const store = tx.objectStore(SAMPLES_STORE);

        for (const sample of state.samples) {
            store.put(sample);
        }

        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        });
        db.close();
    } catch {
        // Silent fail
    }
}
