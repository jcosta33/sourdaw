import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type ActionHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    groupId?: string;
    groupLabel?: string;
    reverted: boolean;
};

export type ActionHistoryState = {
    entries: ActionHistoryEntry[];
};

const MAX_HISTORY = 200;

export const defaultActionHistoryState: ActionHistoryState = { entries: [] };

const ACTION_HISTORY_STATE_KEYS = ['entries'] as const;
const ACTION_HISTORY_ENTRY_REQUIRED_KEYS = ['id', 'label', 'actionKind', 'source', 'timestamp', 'reverted'] as const;
const ACTION_HISTORY_ENTRY_OPTIONAL_KEYS = ['groupId', 'groupLabel'] as const;

type HasExactKeysInput = {
    value: object;
    required_keys: readonly string[];
    optional_keys?: readonly string[];
};

function has_exact_keys({ value, required_keys, optional_keys = [] }: HasExactKeysInput): boolean {
    const value_keys = Object.keys(value);
    const allowed_keys = new Set([...required_keys, ...optional_keys]);

    return required_keys.every((key) => Object.hasOwn(value, key)) && value_keys.every((key) => allowed_keys.has(key));
}

function is_unknown_array(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

function get_record(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    return value as Record<string, unknown>;
}

function get_entry_values(value: unknown): unknown[] | null {
    const record = get_record(value);
    if (record === null) {
        return null;
    }

    if (!is_unknown_array(record.entries)) {
        return null;
    }

    return record.entries;
}

function is_action_history_source(value: unknown): value is ActionHistoryEntry['source'] {
    return value === 'manual' || value === 'prompt' || value === 'voice' || value === 'ai';
}

type SanitizableActionHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    source: ActionHistoryEntry['source'];
    timestamp: number;
    groupId?: string;
    groupLabel?: string;
    reverted: boolean;
};

function get_sanitizable_action_history_entry(value: unknown): SanitizableActionHistoryEntry | null {
    const record = get_record(value);
    if (record === null) {
        return null;
    }

    if (typeof record.id !== 'string') {
        return null;
    }

    if (typeof record.label !== 'string') {
        return null;
    }

    if (typeof record.actionKind !== 'string') {
        return null;
    }

    if (!is_action_history_source(record.source)) {
        return null;
    }

    if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) {
        return null;
    }

    if (typeof record.reverted !== 'boolean') {
        return null;
    }

    const entry: SanitizableActionHistoryEntry = {
        id: record.id,
        label: record.label,
        actionKind: record.actionKind,
        source: record.source,
        timestamp: record.timestamp,
        reverted: record.reverted,
    };

    if (typeof record.groupId === 'string') {
        entry.groupId = record.groupId;
    }

    if (typeof record.groupLabel === 'string') {
        entry.groupLabel = record.groupLabel;
    }

    return entry;
}

function is_sanitizable_action_history_entry(
    value: SanitizableActionHistoryEntry | null
): value is SanitizableActionHistoryEntry {
    return value !== null;
}

function is_exact_action_history_entry(value: unknown): value is ActionHistoryEntry {
    const entry = get_sanitizable_action_history_entry(value);

    return (
        entry !== null &&
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys({
            value,
            required_keys: ACTION_HISTORY_ENTRY_REQUIRED_KEYS,
            optional_keys: ACTION_HISTORY_ENTRY_OPTIONAL_KEYS,
        })
    );
}

function normalize_action_history_entry(entry: SanitizableActionHistoryEntry): ActionHistoryEntry {
    const normalized_entry: ActionHistoryEntry = {
        id: entry.id,
        label: entry.label,
        actionKind: entry.actionKind,
        source: entry.source,
        timestamp: entry.timestamp,
        reverted: entry.reverted,
    };

    if (entry.groupId !== undefined) {
        normalized_entry.groupId = entry.groupId;
    }

    if (entry.groupLabel !== undefined) {
        normalized_entry.groupLabel = entry.groupLabel;
    }

    return normalized_entry;
}

function is_exact_action_history_state(value: unknown): value is ActionHistoryState {
    const entries = get_entry_values(value);

    return (
        value !== null &&
        typeof value === 'object' &&
        has_exact_keys({ value, required_keys: ACTION_HISTORY_STATE_KEYS }) &&
        entries !== null &&
        entries.every(is_exact_action_history_entry)
    );
}

export function sanitize_action_history_state(value: unknown): ActionHistoryState {
    const entries = get_entry_values(value);

    if (is_exact_action_history_state(value) && entries !== null && entries.length <= MAX_HISTORY) {
        return value;
    }

    if (entries === null) {
        return defaultActionHistoryState;
    }

    return {
        entries: entries
            .map(get_sanitizable_action_history_entry)
            .filter(is_sanitizable_action_history_entry)
            .map(normalize_action_history_entry)
            .slice(-MAX_HISTORY),
    };
}

export const actionHistoryStore = createStore<ActionHistoryState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'actionHistory'),
    initialData: defaultActionHistoryState,
    sanitize: sanitize_action_history_state,
});

export function pushActionHistoryEntry(entry: ActionHistoryEntry): void {
    const state = actionHistoryStore.value;
    if (!state) {
        return;
    }
    const entries = [...state.entries, entry].slice(-MAX_HISTORY);
    actionHistoryStore.set({ entries });
}

export function markEntryReverted(entryId: string): void {
    const state = actionHistoryStore.value;
    if (!state) {
        return;
    }
    actionHistoryStore.set({
        entries: state.entries.map((event) => (event.id === entryId ? { ...event, reverted: true } : event)),
    });
}
