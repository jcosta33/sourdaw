import {
    crdtPersistenceQueueCoordinator,
    type CrdtPersistenceBarrierOperation,
    type CrdtPersistenceBarrierResult,
} from './crdtPersistenceQueueCoordinator';

/** Serialize one exact cross-store transition with every CRDT persistence operation. */
export function runCrdtPersistenceBarrier(
    operation: CrdtPersistenceBarrierOperation
): Promise<CrdtPersistenceBarrierResult> {
    return crdtPersistenceQueueCoordinator.runBarrier(operation);
}
