import { runCrdtPersistenceOperation } from './runCrdtPersistenceOperation';

/**
 * Atomically replace persisted CRDT state with a full snapshot.
 * Called periodically and on explicit save.
 */
export function compactProject(): Promise<void> {
    return runCrdtPersistenceOperation('compact');
}
