import { crdtPersistenceQueueCoordinator, type CrdtPersistenceOperation } from './crdtPersistenceQueueCoordinator';

export function runCrdtPersistenceOperation(
    operation: CrdtPersistenceOperation,
    expectedRootHeads?: readonly string[]
): Promise<void> {
    return crdtPersistenceQueueCoordinator.runOperation(operation, expectedRootHeads);
}
