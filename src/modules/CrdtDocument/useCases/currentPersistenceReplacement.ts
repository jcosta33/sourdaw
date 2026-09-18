import { crdtPersistenceQueueCoordinator } from './crdtPersistenceQueueCoordinator';

/**
 * How many times the live project has been replaced by another one.
 *
 * A caller that captured this figure and reads it again can tell that the
 * project it was working on is gone. The persistence generation cannot answer
 * that: a load, a root-lineage transition and an HMR migration bump it too.
 */
export function currentPersistenceReplacement(): number {
    return crdtPersistenceQueueCoordinator.currentReplacement();
}
