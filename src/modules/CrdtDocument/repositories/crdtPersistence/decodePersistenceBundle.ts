import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { PERSISTENCE_AUTHORITY_KEY } from './persistenceAuthorityModel';
import { toPersistenceBytes } from './toPersistenceBytes';

export function decodePersistenceBundle(keys: readonly IDBValidKey[], values: readonly unknown[]): DocumentBundle {
    const bundle: DocumentBundle = new Map();
    for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const value = values[index];
        if (typeof key !== 'string') {
            throw new TypeError(`[CrdtPersistence] Invalid persisted key at index ${index}`);
        }
        if (key === PERSISTENCE_AUTHORITY_KEY) {
            continue;
        }
        const bytes = toPersistenceBytes(value);
        if (!bytes) {
            throw new TypeError(`[CrdtPersistence] Invalid persisted record at index ${index}`);
        }
        bundle.set(key, bytes);
    }
    return bundle;
}
