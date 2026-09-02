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
//
// This flush's captured witness can be stale: it runs before the animation
// frame that lands the action-history entry's own deferred CRDT write, so
// `owner.captureWitness()` here can report the document as it was just
// before that write, not as it durably ends up.
// `stampSessionUndoWitness` re-captures and re-writes the mirror once CRDT
// persistence has forced that write to land, which supersedes whatever this
// flush recorded. A witness this flush leaves stale with no later persist to
// supersede it mismatches the next boot's capture and clears the stacks,
// which is correct: the document never durably received the edit those
// stacks would invert.
let flushScheduled = false;
undoStore.subscribe((value) => {
    if (!value || flushScheduled) {
        return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
        flushScheduled = false;
        writeCurrentSessionMirror(owner);
    });
});

/**
 * Re-mirrors the live stacks against `nextOwner`'s witness, or clears the
 * mirror's owner tag when there isn't one. A no-op when the live stacks are
 * unset — both call sites reach here only through a store subscription or
 * an explicit stamp, so an unset store means there is nothing to mirror.
 */
function writeCurrentSessionMirror(nextOwner: UndoStoreOwner | undefined): void {
    const current = undoStore.value;
    if (!current) {
        return;
    }
    writeSessionMirror({ ...current, projectId: nextOwner?.projectId, witness: nextOwner?.captureWitness() });
}

/**
 * Re-mirrors the live stacks against the document witness `owner.captureWitness()`
 * reports at this exact moment. CRDT persistence calls this once it has force-flushed its own
 * deferred writes and before it serializes bytes for IndexedDB, so the witness this
 * writes matches what actually becomes durable — see the microtask-flush comment
 * above for why that flush alone cannot make this guarantee. A no-op when the live
 * stacks carry no project/document owner.
 */
export function stampSessionUndoWitness(): void {
    if (!owner) {
        return;
    }
    writeCurrentSessionMirror(owner);
}

/**
 * Raw setter. Pushes an entry onto the past stack and clears future.
 * Callers that also need branching-undo-tree mirroring should use
 * `commitUndoEntry` from `#/modules/Command/useCases` instead.
 */
export function pushUndo(entry: UndoEntry): void {
    pushUndoEntries([entry]);
}

export function pushUndoEntries(entries: readonly UndoEntry[]): void {
    const state = undoStore.value;
    if (!state) {
        return;
    }
    undoStore.set({
        past: [...state.past, ...entries],
        future: [],
    });
}
