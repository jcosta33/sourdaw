import { createStore } from '#/infra/store/createStore';

import { type UndoEntry } from '../models/UndoEntry';

import { hydrateSessionMirror, type SessionActionContract, writeSessionMirror } from './undoSessionMirror';

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

export const undoStore = createStore<UndoStoreState>({
    initialData: { past: [], future: [] },
});

/**
 * The project the live stacks are currently tagged as belonging to. Seeded at
 * boot hydration from whatever identity the mirror was written against, and
 * re-tagged by every `reconcileUndoStoreForProject` call so later mirror
 * flushes stay attributed to the project actually driving the pushes.
 */
let activeUndoProjectId: string | undefined;

/**
 * Hydrates persisted undo history only after production handler registration
 * has established the current executable action set. Unknown, retired, and
 * re-shaped actions never enter the live undo/redo stacks.
 */
export function hydrateUndoStoreFromSession(actionContracts: Iterable<SessionActionContract>): void {
    const { past, future, projectId } = hydrateSessionMirror(actionContracts);
    activeUndoProjectId = projectId;
    undoStore.set({ past, future });
}

/**
 * Boot restore reconciliation: keeps the hydrated stacks when they were
 * mirrored against the same project `loadProject` just restored, and clears
 * them otherwise (a different project, or a mirror with no recorded owner).
 * Also re-tags the live stacks to `projectId` so this session's own mirror
 * flushes record the right owner going forward.
 */
export function reconcileUndoStoreForProject(projectId: string | undefined): void {
    const matchesHydratedProject = projectId !== undefined && projectId === activeUndoProjectId;
    activeUndoProjectId = projectId;
    if (!matchesHydratedProject) {
        undoStore.set({ past: [], future: [] });
    }
}

// Coalesce persistence writes: prior to this, every pushUndo triggered
// an immediate full JSON.stringify(trimmed) + sessionStorage write
// (§85.2). Rapid undo pushes (AI action batches, drag gestures) produced
// hundreds of writes per second. Defer the write to a microtask flush so
// successive pushes in the same turn produce exactly one serialize.
let flushScheduled = false;
undoStore.subscribe((value) => {
    if (!value || flushScheduled) {
        return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
        flushScheduled = false;
        const current = undoStore.value;
        if (!current) {
            return;
        }
        writeSessionMirror({ ...current, projectId: activeUndoProjectId });
    });
});

/**
 * Raw setter. Pushes an entry onto the past stack and clears future.
 * Callers that also need branching-undo-tree mirroring should use
 * `commitUndoEntry` from `#/modules/Command/useCases` instead.
 */
export function pushUndo(entry: UndoEntry): void {
    const state = undoStore.value;
    if (!state) {
        return;
    }
    undoStore.set({
        past: [...state.past, entry],
        future: [],
    });
}
