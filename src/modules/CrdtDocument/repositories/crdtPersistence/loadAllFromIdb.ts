import { type DocumentBundle } from '../../models/CrdtDocumentTypes';

import { loadPersistenceSnapshotFromIdb } from './loadPersistenceSnapshotFromIdb';

/** Load all documents from IndexedDB. */
export async function loadAllFromIdb(): Promise<DocumentBundle | null> {
    const snapshot = await loadPersistenceSnapshotFromIdb();
    return snapshot?.bundle ?? null;
}
