import { type GrinderImportedNeuralModel } from '../../models/GrinderPatch';

import {
    classifyGrinderNeuralPersistenceError,
    type GrinderNeuralPersistenceResult,
} from './classifyGrinderNeuralPersistenceError';

/**
 * A self-imposed ceiling on the neural library's IndexedDB footprint. Each
 * imported entry carries the full 1–50 MB NAM JSON source text, so a few large
 * captures can blow whatever the origin is actually granted, mid-write, and
 * corrupt the whole `entries` record. Refuse up front with a distinct quota
 * error rather than letting the transaction fail opaquely.
 *
 * The figure was originally Safari's ungranted per-origin cap. Chromium grants
 * far more, so this is now a conservative budget rather than an engine limit.
 */
const NEURAL_LIBRARY_BYTE_BUDGET = 45 * 1024 * 1024;

function measure_source_bytes(entries: readonly GrinderImportedNeuralModel[]): number {
    let total = 0;
    for (const entry of entries) {
        if (typeof entry.sourceFileText === 'string') {
            // UTF-16 source held in memory; two bytes per code unit is a safe
            // upper bound for the on-disk footprint of the JSON payload.
            total += entry.sourceFileText.length * 2;
        }
    }
    return total;
}

type PersistGrinderNeuralLibraryInput = {
    entries: readonly GrinderImportedNeuralModel[];
};

export async function persistGrinderNeuralLibrary(
    input: PersistGrinderNeuralLibraryInput
): Promise<GrinderNeuralPersistenceResult> {
    const database_name = 'sourdaw-grinder-neural';
    const store_name = 'imported-model-library';

    const source_bytes = measure_source_bytes(input.entries);
    if (source_bytes > NEURAL_LIBRARY_BYTE_BUDGET) {
        return {
            ok: false,
            error: {
                code: 'quota_exceeded',
                message: `Neural library payload (${Math.round(source_bytes / (1024 * 1024))} MB) exceeds the ${Math.round(
                    NEURAL_LIBRARY_BYTE_BUDGET / (1024 * 1024)
                )} MB storage budget.`,
            },
        };
    }

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
            transaction.onerror = () =>
                reject(transaction.error ?? new Error('Failed to persist Grinder neural library'));
        });
        database.close();
        return { ok: true };
    } catch (error) {
        return { ok: false, error: classifyGrinderNeuralPersistenceError(error) };
    }
}
