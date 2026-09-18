import { type CrdtPersistenceAuthority } from '../repositories/crdtPersistence/persistenceAuthorityModel';

import { crdtPersistenceQueueCoordinator } from './crdtPersistenceQueueCoordinator';

/** Point the persistence queue at a replacement project under `epoch`. */
export function beginPersistenceReplacement(input: { epoch: string; old: CrdtPersistenceAuthority | null }): void {
    crdtPersistenceQueueCoordinator.beginReplacement(input);
}
