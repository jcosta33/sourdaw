import {
    crdtPersistenceQueueCoordinator,
    type CrdtPersistenceBarrierOperation,
} from './crdtPersistenceQueueCoordinator';

/** Serialize one exact cross-store transition with every CRDT persistence operation. */
export function runCrdtPersistenceBarrier(operation: CrdtPersistenceBarrierOperation): Promise<void> {
    return crdtPersistenceQueueCoordinator.runBarrier(operation);
}
