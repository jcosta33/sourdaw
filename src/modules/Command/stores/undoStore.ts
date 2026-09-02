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
 * Hydrates persisted undo history only after production handler registration
 * has established the current executable action set. Unknown, retired, and
 * re-shaped actions never enter the live undo/redo stacks.
 */
export function hydrateUndoStoreFromSession(actionContracts: Iterable<SessionActionContract>): void {
    undoStore.set(hydrateSessionMirror(actionContracts));
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
        writeSessionMirror(current);
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
