import { type GrinderImportedNeuralModel } from '../../models/GrinderPatch';

type PersistGrinderNeuralLibraryInput = {
    entries: readonly GrinderImportedNeuralModel[];
};

export async function persistGrinderNeuralLibrary(input: PersistGrinderNeuralLibraryInput): Promise<void> {
    const database_name = 'sourdaw-grinder-neural';
    const store_name = 'imported-model-library';

    try {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(database_name, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(store_name)) {
                    db.createObjectStore(store_name);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('Failed to open Grinder neural database'));
        });

        const transaction = database.transaction(store_name, 'readwrite');
        transaction.objectStore(store_name).put([...input.entries], 'entries');

        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error ?? new Error('Failed to persist Grinder neural library'));
        });
        database.close();
    } catch {
        // Best effort persistence only.
    }
}
