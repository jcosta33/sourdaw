// Holder object instead of a raw module-level `let` so the compaction counter
// is shared by lifecycle use cases without becoming externally writable.
export const crdtProjectCompactionState = { incrementalSaveCount: 0 };

export const CRDT_PROJECT_COMPACTION_THRESHOLD = 50;
