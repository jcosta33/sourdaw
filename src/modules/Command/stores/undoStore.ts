import { createStore } from '#/infra/store/createStore';

import { type UndoEntry } from '../useCases/commandQueries';
import { isActionEntry } from '../useCases/isActionEntry';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const MAX_UNDO_PERSIST = 100;

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

type StoredUndoEntry = Omit<UndoEntry, 'kind'> & {
    kind?: UndoEntry['kind'];
};

type StoredUndoStoreState = {
    past: StoredUndoEntry[];
    future: StoredUndoEntry[];
};

function loadFromSession(): UndoStoreState {
    try {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as StoredUndoStoreState;
            if (Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
                function ensureKind(event: StoredUndoEntry): UndoEntry {
                    return { ...event, kind: event.kind ?? 'action' } as UndoEntry;
                }
                return {
                    past: parsed.past.map(ensureKind),
                    future: parsed.future.map(ensureKind),
                };
            }
        }
    } catch {
        /* ignore */
    }
    return { past: [], future: [] };
}

export const undoStore = createStore<UndoStoreState>({
    initialData: loadFromSession(),
});

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
        try {
            function serializableOnly(entries: UndoEntry[]) {
                return entries.filter(isActionEntry).slice(-MAX_UNDO_PERSIST);
            }
            const trimmed: UndoStoreState = {
                past: serializableOnly(current.past),
                future: serializableOnly(current.future),
            };
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(trimmed));
        } catch {
            /* storage full or unavailable */
        }
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
