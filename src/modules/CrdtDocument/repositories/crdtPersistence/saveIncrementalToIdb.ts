import { type DocId } from '../../models/CrdtDocumentTypes';

import { saveIncrementalsToIdb, type SaveIncrementalsToIdbResult } from './saveIncrementalsToIdb';

/** Save an incremental chunk for a document (append, don't replace). */
export async function saveIncrementalToIdb(id: DocId, chunk: Uint8Array): Promise<SaveIncrementalsToIdbResult> {
    return saveIncrementalsToIdb([{ id, chunk }]);
}
