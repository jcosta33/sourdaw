// Shared lifecycle state for incremental compaction; intentionally not exported
// from the public CrdtDocument use-case barrel.
export const crdtProjectCompactionState = { incrementalSaveCount: 0 };

export const CRDT_PROJECT_COMPACTION_THRESHOLD = 50;
