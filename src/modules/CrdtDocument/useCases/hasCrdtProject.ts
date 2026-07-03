import { hasCrdtDocsInIdb } from '../repositories/crdtPersistence/hasCrdtDocsInIdb';

/**
 * Check whether a CRDT project exists in persistence.
 */
export async function hasCrdtProject(): Promise<boolean> {
    return hasCrdtDocsInIdb();
}
