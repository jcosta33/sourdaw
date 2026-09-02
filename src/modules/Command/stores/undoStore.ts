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

type UndoStoreOwner = {
    readonly projectId: string;
    readonly captureWitness: () => string;
};

/**
 * The project and document witness the live stacks are currently tagged as
 * belonging to. Seeded at boot hydration from whatever identity the mirror
 * was written against (frozen to that historical witness value), and
 * re-tagged by every `reconcileUndoStoreForProject` call to the live
 * `captureWitness` it was given, so later mirror flushes record the
 * document's witness as of the moment of each flush rather than a stale one.
 * `undefined` means the stacks carry no owner: nothing tags a mirror flush,
 * and the next reconcile always clears rather than risk matching on a
 * project id alone.
 */
let owner: UndoStoreOwner | undefined;

/**
 * Hydrates persisted undo history only after production handler registration
 * has established the current executable action set. Unknown, retired, and
 * re-shaped actions never enter the live undo/redo stacks.
 */
export function hydrateUndoStoreFromSession(actionContracts: Iterable<SessionActionContract>): void {
    const { past, future, projectId, witness } = hydrateSessionMirror(actionContracts);
    // A mirror missing either half of its recorded identity hydrates to no
    // owner, so the reconciliation below always clears rather than matching
    // on a partial identity.
    owner = projectId !== undefined && witness !== undefined ? { projectId, captureWitness: () => witness } : undefined;
    undoStore.set({ past, future });
}

/**
 * Boot restore reconciliation: keeps the hydrated stacks when both the
 * project id AND the document witness `captureWitness()` reports now match
 * what the mirror was written against, and clears them otherwise — a
 * different project, a divergent document under the same project id (a
 * stale restore, or edits the mirror never captured), or a mirror with no
 * recorded owner. Also re-tags the live stacks to `{ projectId,
 * captureWitness }` so this session's own mirror flushes record the right
 * owner, and its current document witness, going forward.
 */
export function reconcileUndoStoreForProject(projectId: string | undefined, captureWitness: () => string): void {
    const matchesOwner =
        projectId !== undefined &&
        owner !== undefined &&
        projectId === owner.projectId &&
        captureWitness() === owner.captureWitness();
    owner = projectId === undefined ? undefined : { projectId, captureWitness };
    if (!matchesOwner) {
        undoStore.set({ past: [], future: [] });
    }
}

/**
 * Drops the live stacks' project/document tag without touching the stacks
 * themselves. Every in-session project transition (`clearUndoHistory`) calls
 * this alongside emptying the stacks, so a mirror flush after that
 * transition carries no identity at all and the next boot always clears —
 * accepted as fail-safe, at the cost of an in-session switch always forfeit-
 * ing undo history across the following reload, even back to the project it
 * left, because nothing re-tags it.
 */
export function clearUndoStoreOwner(): void {
    owner = undefined;
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
        writeSessionMirror({ ...current, projectId: owner?.projectId, witness: owner?.captureWitness() });
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
