import { type CrdtPersistenceAuthority } from '../repositories/crdtPersistence/persistenceAuthorityModel';

import { crdtPersistenceQueueCoordinator } from './crdtPersistenceQueueCoordinator';

/** Read the durable persistence authority behind the persistence queue. */
export function readDurablePersistenceAuthority(): Promise<CrdtPersistenceAuthority> {
    return crdtPersistenceQueueCoordinator.readDurableAuthority();
}
