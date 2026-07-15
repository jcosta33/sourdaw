import { parseCrdtRootLineage } from '../../models/CrdtRootLineage';

import { type CrdtPersistenceAuthority } from './persistenceAuthorityModel';

export function advancePersistenceAuthority(
    current: CrdtPersistenceAuthority,
    epoch = current.epoch,
    rootLineage = current.rootLineage
): CrdtPersistenceAuthority {
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('[CrdtPersistence] Persistence revision exhausted');
    }

    const validatedRootLineage = parseCrdtRootLineage(rootLineage);
    if (!validatedRootLineage) {
        throw new TypeError('[CrdtPersistence] Invalid root lineage');
    }

    return {
        epoch,
        revision: current.revision + 1,
        rootLineage: validatedRootLineage,
    };
}
