import { crdtPersistenceQueueCoordinator, type CrdtPersistenceOperation } from './crdtPersistenceQueueCoordinator';

export function runCrdtPersistenceOperation(operation: CrdtPersistenceOperation): Promise<void> {
    return crdtPersistenceQueueCoordinator.runOperation(operation);
}
