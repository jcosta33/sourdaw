import { reconcileUndoStoreForProject } from '../stores/undoStore';

export type SessionUndoReconciliationTarget = {
    /** The project boot restore just loaded, or `undefined` for a legacy
     *  document that has not yet migrated to a canonical id. */
    readonly projectId: string | undefined;
    /** Captures a durable witness for the document boot restore just loaded
     *  (see `CrdtDocument`'s `captureDurableDocumentWitness`). Injected here
     *  rather than imported directly: Command must not depend on
     *  CrdtDocument, which already depends on Command. */
    readonly captureWitness: () => string;
};

/**
 * Boot restore calls this once it knows which project and document it just
 * loaded: the hydrated-from-session-mirror undo history survives when both
 * `projectId` and the document's current witness match what the mirror was
 * written against, and is cleared otherwise.
 */
export function reconcileSessionUndoForProject({ projectId, captureWitness }: SessionUndoReconciliationTarget): void {
    reconcileUndoStoreForProject(projectId, captureWitness);
}
