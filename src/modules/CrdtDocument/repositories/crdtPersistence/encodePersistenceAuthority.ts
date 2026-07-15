import { parseCrdtRootLineage } from '../../models/CrdtRootLineage';

import { PERSISTENCE_AUTHORITY_VERSION, type CrdtPersistenceAuthority } from './persistenceAuthorityModel';

export function encodePersistenceAuthority(authority: CrdtPersistenceAuthority): Uint8Array {
    const rootLineage = parseCrdtRootLineage(authority.rootLineage);
    if (!rootLineage) {
        throw new TypeError('[CrdtPersistence] Invalid root lineage');
    }

    return new TextEncoder().encode(
        JSON.stringify({
            version: PERSISTENCE_AUTHORITY_VERSION,
            epoch: authority.epoch,
            revision: authority.revision,
            rootLineage,
        })
    );
}
