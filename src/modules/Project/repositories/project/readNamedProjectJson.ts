import { readNamedProjectJsonFromIndexedDb } from './readNamedProjectJsonFromIndexedDb';

/** Read one named project from the current project store of record. */
export async function readNamedProjectJson(key: string): Promise<string | null> {
    return readNamedProjectJsonFromIndexedDb(key);
}
