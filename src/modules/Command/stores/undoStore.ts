import { createStore } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry, isActionEntry, type UndoEntry, type UndoSource } from '../models/UndoEntry';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const MAX_UNDO_PERSIST = 100;

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

type StoredTransactionMarker = {
    index: number;
    size: number;
};

type SanitizedStoredEntry = {
    entry: ActionUndoEntry;
    transactionMarker?: StoredTransactionMarker;
};

type PersistedActionEntry = ActionUndoEntry & {
    transactionGroupIndex?: number;
    transactionGroupSize?: number;
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
    if (value.type === 'restoreDsoSnapshot') {
        return false;
    }
    return typeof value.type === 'string' && value.type.length > 0;
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

function sanitizeStoredEntry(value: unknown): SanitizedStoredEntry | null {
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

    const transactionGroupId = getOptionalString(value, 'transactionGroupId');
    if (transactionGroupId === null || transactionGroupId === '') {
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
    if (transactionGroupId !== undefined) {
        entry.transactionGroupId = transactionGroupId;
    }

    const transactionGroupIndex = value.transactionGroupIndex;
    const transactionGroupSize = value.transactionGroupSize;
    const hasValidTransactionMarker =
        transactionGroupId !== undefined &&
        typeof transactionGroupIndex === 'number' &&
        Number.isInteger(transactionGroupIndex) &&
        transactionGroupIndex >= 0 &&
        typeof transactionGroupSize === 'number' &&
        Number.isInteger(transactionGroupSize) &&
        transactionGroupSize > 0;

    return {
        entry,
        ...(hasValidTransactionMarker
            ? { transactionMarker: { index: transactionGroupIndex, size: transactionGroupSize } }
            : {}),
    };
}

function sanitizeStoredEntries(values: unknown[]): ActionUndoEntry[] {
    const candidates = values.map(sanitizeStoredEntry);

    for (let start = 0; start < candidates.length; ) {
        const groupId = candidates[start]?.entry.transactionGroupId;
        if (!groupId) {
            start += 1;
            continue;
        }

        let end = start + 1;
        while (candidates[end]?.entry.transactionGroupId === groupId) {
            end += 1;
        }
        const groupSize = end - start;
        const complete = candidates
            .slice(start, end)
            .every(
                (candidate, index) =>
                    candidate?.transactionMarker?.index === index && candidate.transactionMarker.size === groupSize
            );
        if (!complete) {
            for (let index = start; index < end; index += 1) {
                const candidate = candidates[index];
                if (candidate) {
                    delete candidate.entry.transactionGroupId;
                }
            }
        }
        start = end;
    }

    return candidates.flatMap((candidate) => (candidate ? [candidate.entry] : []));
}

function collectHistoryUnits(entries: UndoEntry[]): UndoEntry[][] {
    const units: UndoEntry[][] = [];
    for (let start = 0; start < entries.length; ) {
        const groupId = entries[start]?.transactionGroupId;
        let end = start + 1;
        if (groupId) {
            while (entries[end]?.transactionGroupId === groupId) {
                end += 1;
            }
        }
        const unit = entries.slice(start, end);
        units.push(unit);
        start = end;
    }
    return units;
}

function asPersistableUnit(unit: UndoEntry[]): ActionUndoEntry[] | null {
    const persistable = unit.flatMap((entry) => (isSessionPersistableActionEntry(entry) ? [entry] : []));
    return persistable.length === unit.length ? persistable : null;
}

function collectContiguousPersistableUnits(entries: UndoEntry[], edge: 'head' | 'tail'): ActionUndoEntry[][] {
    const history_units = collectHistoryUnits(entries);
    const persistable_units: ActionUndoEntry[][] = [];

    if (edge === 'head') {
        for (const history_unit of history_units) {
            const persistable_unit = asPersistableUnit(history_unit);
            if (!persistable_unit) {
                break;
            }
            persistable_units.push(persistable_unit);
        }
        return persistable_units;
    }

    for (let index = history_units.length - 1; index >= 0; index -= 1) {
        const persistable_unit = asPersistableUnit(history_units[index]!);
        if (!persistable_unit) {
            break;
        }
        persistable_units.unshift(persistable_unit);
    }
    return persistable_units;
}

function serializeUnit(unit: ActionUndoEntry[]): PersistedActionEntry[] {
    const transactionGroupId = unit[0]?.transactionGroupId;
    if (!transactionGroupId) {
        return unit;
    }
    return unit.map((entry, index) => ({
        ...entry,
        transactionGroupIndex: index,
        transactionGroupSize: unit.length,
    }));
}

function trimPersistableEntries(entries: UndoEntry[], edge: 'head' | 'tail'): PersistedActionEntry[] {
    const units = collectContiguousPersistableUnits(entries, edge);
    const selected: ActionUndoEntry[][] = [];
    let count = 0;

    if (edge === 'head') {
        for (const unit of units) {
            if (count + unit.length > MAX_UNDO_PERSIST) {
                break;
            }
            selected.push(unit);
            count += unit.length;
        }
    } else {
        for (let index = units.length - 1; index >= 0; index -= 1) {
            const unit = units[index]!;
            if (count + unit.length > MAX_UNDO_PERSIST) {
                break;
            }
            selected.unshift(unit);
            count += unit.length;
        }
    }

    return selected.flatMap(serializeUnit);
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
            const trimmed: UndoStoreState = {
                past: trimPersistableEntries(current.past, 'tail'),
                future: trimPersistableEntries(current.future, 'head'),
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
