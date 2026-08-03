import { createStore } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry, isActionEntry, type UndoEntry, type UndoSource } from '../models/UndoEntry';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const MAX_UNDO_PERSIST = 100;
const RETIRED_SESSION_ACTION_TYPES = new Set(['restoreDsoSnapshot']);

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUndoSource(value: unknown): value is UndoSource {
    return value === 'manual' || value === 'prompt' || value === 'voice' || value === 'ai';
}

function isSessionPersistableAppAction(value: unknown): value is AppAction {
    if (!isRecord(value)) {
        return false;
    }
    return typeof value.type === 'string' && value.type.length > 0 && !RETIRED_SESSION_ACTION_TYPES.has(value.type);
}

function isSessionPersistableActionEntry(entry: UndoEntry): entry is ActionUndoEntry {
    if (!isActionEntry(entry)) {
        return false;
    }
    if (!isSessionPersistableAppAction(entry.action)) {
        return false;
    }
    return entry.inverseAction === null || isSessionPersistableAppAction(entry.inverseAction);
}

function getOptionalString(value: Record<string, unknown>, key: string): string | null | undefined {
    const maybeString = value[key];
    if (maybeString === undefined) {
        return undefined;
    }
    if (typeof maybeString !== 'string') {
        return null;
    }
    return maybeString;
}

function sanitizeStoredEntry(value: unknown): ActionUndoEntry | null {
    if (!isRecord(value)) {
        return null;
    }
    if (value.kind !== undefined && value.kind !== 'action') {
        return null;
    }
    if (typeof value.id !== 'string' || typeof value.label !== 'string') {
        return null;
    }
    if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) {
        return null;
    }

    const action = value.action;
    if (!isSessionPersistableAppAction(action)) {
        return null;
    }

    const inverseAction = value.inverseAction;
    if (inverseAction !== null && !isSessionPersistableAppAction(inverseAction)) {
        return null;
    }

    const source = value.source ?? 'manual';
    if (!isUndoSource(source)) {
        return null;
    }

    const groupId = getOptionalString(value, 'groupId');
    if (groupId === null) {
        return null;
    }

    const groupLabel = getOptionalString(value, 'groupLabel');
    if (groupLabel === null) {
        return null;
    }

    const entry: ActionUndoEntry = {
        id: value.id,
        kind: 'action',
        label: value.label,
        action,
        inverseAction,
        timestamp: value.timestamp,
        source,
    };

    if (groupId !== undefined) {
        entry.groupId = groupId;
    }
    if (groupLabel !== undefined) {
        entry.groupLabel = groupLabel;
    }

    return entry;
}

function sanitizeStoredEntries(values: unknown[]): ActionUndoEntry[] {
    return values.flatMap((value) => {
        const entry = sanitizeStoredEntry(value);
        return entry === null ? [] : [entry];
    });
}

function loadFromSession(): UndoStoreState {
    try {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (isRecord(parsed) && Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
                return {
                    past: sanitizeStoredEntries(parsed.past),
                    future: sanitizeStoredEntries(parsed.future),
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
                return entries.filter(isSessionPersistableActionEntry).slice(-MAX_UNDO_PERSIST);
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
