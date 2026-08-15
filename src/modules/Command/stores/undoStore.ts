import { createStore } from '#/infra/store/createStore';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionUndoEntry, isActionEntry, type UndoEntry, type UndoSource } from '../models/UndoEntry';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const MAX_UNDO_PERSIST = 100;

let supportedSessionActionVersions: ReadonlyMap<string, number> | null = null;

export type UndoStoreState = {
    past: UndoEntry[];
    future: UndoEntry[];
};

type SerializedActionUndoEntry = ActionUndoEntry & {
    actionOperationVersion: number;
    inverseActionOperationVersion?: number;
    redoActionOperationVersion?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUndoSource(value: unknown): value is UndoSource {
    return value === 'manual' || value === 'prompt' || value === 'voice' || value === 'ai';
}

function getCurrentOperationVersion(
    value: unknown,
    supportedActionVersions: ReadonlyMap<string, number> | null = supportedSessionActionVersions
): number | null {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.type !== 'string') {
        return null;
    }
    return supportedActionVersions?.get(value.type) ?? null;
}

function getStoredOperationVersion(value: Record<string, unknown>, key: string): number | null | undefined {
    const version = value[key];
    if (version === undefined) {
        return undefined;
    }
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
        return null;
    }
    return version as number;
}

function actionMatchesStoredOperationVersion(
    action: unknown,
    storedVersion: number | undefined,
    supportedActionVersions: ReadonlyMap<string, number>
): action is AppAction {
    const currentVersion = getCurrentOperationVersion(action, supportedActionVersions);
    return currentVersion !== null && (storedVersion ?? 1) === currentVersion;
}

function serializeSessionActionEntry(entry: UndoEntry): SerializedActionUndoEntry | null {
    if (!isActionEntry(entry)) {
        return null;
    }
    const actionOperationVersion = getCurrentOperationVersion(entry.action);
    if (actionOperationVersion === null) {
        return null;
    }
    const inverseActionOperationVersion =
        entry.inverseAction === null ? null : getCurrentOperationVersion(entry.inverseAction);
    if (entry.inverseAction !== null && inverseActionOperationVersion === null) {
        return null;
    }
    const redoActionOperationVersion =
        entry.redoAction === undefined ? null : getCurrentOperationVersion(entry.redoAction);
    if (entry.redoAction !== undefined && redoActionOperationVersion === null) {
        return null;
    }

    return {
        ...entry,
        actionOperationVersion,
        ...(inverseActionOperationVersion === null ? {} : { inverseActionOperationVersion }),
        ...(redoActionOperationVersion === null ? {} : { redoActionOperationVersion }),
    };
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

function sanitizeStoredEntry(
    value: unknown,
    supportedActionVersions: ReadonlyMap<string, number>
): ActionUndoEntry | null {
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
    const actionOperationVersion = getStoredOperationVersion(value, 'actionOperationVersion');
    if (
        actionOperationVersion === null ||
        !actionMatchesStoredOperationVersion(action, actionOperationVersion, supportedActionVersions)
    ) {
        return null;
    }

    const storedInverseAction = value.inverseAction;
    const inverseActionOperationVersion = getStoredOperationVersion(value, 'inverseActionOperationVersion');
    if (inverseActionOperationVersion === null) {
        return null;
    }
    let inverseAction: AppAction | null;
    if (storedInverseAction === null) {
        if (inverseActionOperationVersion !== undefined) {
            return null;
        }
        inverseAction = null;
    } else if (
        actionMatchesStoredOperationVersion(storedInverseAction, inverseActionOperationVersion, supportedActionVersions)
    ) {
        inverseAction = storedInverseAction;
    } else {
        return null;
    }

    const storedRedoAction = value.redoAction;
    const redoActionOperationVersion = getStoredOperationVersion(value, 'redoActionOperationVersion');
    if (redoActionOperationVersion === null) {
        return null;
    }
    let redoAction: AppAction | undefined;
    if (storedRedoAction === undefined) {
        if (redoActionOperationVersion !== undefined) {
            return null;
        }
        redoAction = undefined;
    } else if (
        actionMatchesStoredOperationVersion(storedRedoAction, redoActionOperationVersion, supportedActionVersions)
    ) {
        redoAction = storedRedoAction;
    } else {
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
    if (redoAction !== undefined) {
        entry.redoAction = redoAction;
    }

    return entry;
}

function sanitizeStoredEntries(
    values: unknown[],
    supportedActionVersions: ReadonlyMap<string, number>
): ActionUndoEntry[] {
    return values.flatMap((value) => {
        const entry = sanitizeStoredEntry(value, supportedActionVersions);
        return entry === null ? [] : [entry];
    });
}

function loadFromSession(supportedActionVersions: ReadonlyMap<string, number>): UndoStoreState {
    try {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (isRecord(parsed) && Array.isArray(parsed.past) && Array.isArray(parsed.future)) {
                return {
                    past: sanitizeStoredEntries(parsed.past, supportedActionVersions),
                    future: sanitizeStoredEntries(parsed.future, supportedActionVersions),
                };
            }
        }
    } catch {
        /* ignore */
    }
    return { past: [], future: [] };
}

export const undoStore = createStore<UndoStoreState>({
    initialData: { past: [], future: [] },
});

/**
 * Hydrates persisted undo history only after production handler registration
 * has established the current executable action set. Unknown and retired
 * actions never enter the live undo/redo stacks.
 */
export function hydrateUndoStoreFromSession(actionVersions: Iterable<readonly [string, number]>): void {
    supportedSessionActionVersions = new Map(actionVersions);
    undoStore.set(loadFromSession(supportedSessionActionVersions));
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
        try {
            function serializableOnly(entries: UndoEntry[]) {
                return entries
                    .flatMap((entry) => {
                        const storedEntry = serializeSessionActionEntry(entry);
                        return storedEntry === null ? [] : [storedEntry];
                    })
                    .slice(-MAX_UNDO_PERSIST);
            }
            const trimmed = {
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
