import { NAMED_PROJECT_KEY_PREFIX } from '../../models/ProjectData';

import { storageSupport } from './storageSupport';

type NamedProjectJsonRecord = {
    json: string;
    key: string;
};

export async function listNamedProjectJsonRecords(): Promise<readonly NamedProjectJsonRecord[]> {
    const records = await storageSupport.listIndexedDbRecords();
    const namedRecords: NamedProjectJsonRecord[] = [];

    for (const record of records) {
        if (typeof record.key !== 'string' || !record.key.startsWith(NAMED_PROJECT_KEY_PREFIX)) {
            continue;
        }
        if (typeof record.value !== 'string') {
            throw new TypeError(`Named project record ${record.key} does not contain JSON text.`);
        }
        namedRecords.push({ json: record.value, key: record.key });
    }

    return namedRecords;
}
