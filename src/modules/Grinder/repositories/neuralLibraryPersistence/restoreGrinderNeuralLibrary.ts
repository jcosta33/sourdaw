import { type GrinderImportedNeuralModel } from '../../models/GrinderPatch';

function normalize_imported_entry(entry: GrinderImportedNeuralModel): GrinderImportedNeuralModel {
    return {
        ...entry,
        sourceFileName: typeof entry.sourceFileName === 'string' ? entry.sourceFileName : null,
        sourceFileText: typeof entry.sourceFileText === 'string' ? entry.sourceFileText : null,
    };
}

export async function restoreGrinderNeuralLibrary(): Promise<GrinderImportedNeuralModel[]> {
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

        const transaction = database.transaction(store_name, 'readonly');
        const request = transaction.objectStore(store_name).get('entries');

        const entries = await new Promise<GrinderImportedNeuralModel[]>((resolve, reject) => {
            request.onsuccess = () =>
                resolve(
                    Array.isArray(request.result)
                        ? (request.result as GrinderImportedNeuralModel[]).map(normalize_imported_entry)
                        : []
                );
            request.onerror = () => reject(request.error ?? new Error('Failed to restore Grinder neural library'));
        });
        database.close();
        return entries;
    } catch {
        return [];
    }
}
