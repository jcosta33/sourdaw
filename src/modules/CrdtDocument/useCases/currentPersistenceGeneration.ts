import { crdtPersistenceQueueCoordinator } from './crdtPersistenceQueueCoordinator';

/** The live persistence generation, bumped whenever the project is replaced or loaded. */
export function currentPersistenceGeneration(): number {
    return crdtPersistenceQueueCoordinator.currentGeneration();
}
