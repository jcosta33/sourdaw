import { runCrdtPersistenceOperation } from './runCrdtPersistenceOperation';

/**
 * Persist the current project incrementally.
 *
 * Uses `Automerge.saveIncremental()` which only serializes changes since
 * the last save - much faster than a full save for small edits.
 * Periodically compacts to a full snapshot for fast startup and bounded storage.
 */
export function persistCrdtProject(): Promise<void> {
    return runCrdtPersistenceOperation('incremental');
}
