import { type GrinderImportedNeuralModel } from '../../models/GrinderPatch';

import {
    classifyGrinderNeuralPersistenceError,
    type GrinderNeuralPersistenceError,
} from './persistGrinderNeuralLibrary';

export type GrinderNeuralRestoreResult =
    | { ok: true; entries: GrinderImportedNeuralModel[] }
    | { ok: false; error: GrinderNeuralPersistenceError };

function normalize_imported_entry(entry: GrinderImportedNeuralModel): GrinderImportedNeuralModel {
    return {
        ...entry,
        sourceFileName: typeof entry.sourceFileName === 'string' ? entry.sourceFileName : null,
        sourceFileText: typeof entry.sourceFileText === 'string' ? entry.sourceFileText : null,
    };
}

/**
 * Restore the imported neural library, differentiating IndexedDB failures
 * (quota / schema / permission) into domain errors instead of silently
 * collapsing every problem to an empty list. Callers that need the error
 * channel use this; the legacy array-returning helper below preserves the
 * previous best-effort shape for existing call sites.
 */
export async function restoreGrinderNeuralLibraryResult(): Promise<GrinderNeuralRestoreResult> {
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
        return { ok: true, entries };
    } catch (error) {
        return { ok: false, error: classifyGrinderNeuralPersistenceError(error) };
    }
}

export async function restoreGrinderNeuralLibrary(): Promise<GrinderImportedNeuralModel[]> {
    const result = await restoreGrinderNeuralLibraryResult();
    return result.ok ? result.entries : [];
}
