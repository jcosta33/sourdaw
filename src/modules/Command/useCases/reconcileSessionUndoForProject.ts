import { reconcileUndoStoreForProject } from '../stores/undoStore';

/**
 * Boot restore calls this once it knows which project it just loaded: the
 * hydrated-from-session-mirror undo history survives when `projectId` matches
 * the project the mirror was written against, and is cleared otherwise.
 */
export function reconcileSessionUndoForProject(projectId: string | undefined): void {
    reconcileUndoStoreForProject(projectId);
}
