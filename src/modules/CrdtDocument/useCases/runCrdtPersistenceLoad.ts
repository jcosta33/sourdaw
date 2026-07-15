import { crdtPersistenceQueueCoordinator, type LoadCrdtPersistenceOperation } from './crdtPersistenceQueueCoordinator';

export function runCrdtPersistenceLoad(operation: LoadCrdtPersistenceOperation): Promise<boolean> {
    return crdtPersistenceQueueCoordinator.runLoad(operation);
}
