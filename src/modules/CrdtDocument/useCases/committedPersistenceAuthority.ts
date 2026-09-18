import { type CrdtPersistenceAuthority } from '../repositories/crdtPersistence/persistenceAuthorityModel';

import { crdtPersistenceQueueCoordinator } from './crdtPersistenceQueueCoordinator';

/** The authority the newest committed save of the live generation wrote. */
export function committedPersistenceAuthority(): CrdtPersistenceAuthority | null {
    return crdtPersistenceQueueCoordinator.committedAuthority();
}
