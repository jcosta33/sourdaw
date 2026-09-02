import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

import {
    type ActionHistoryEntry,
    type ActionHistoryState,
    defaultActionHistoryState,
    sanitize_action_history_state,
} from '../models/ActionHistoryState';

export {
    type ActionHistoryEntry,
    type ActionHistoryState,
    defaultActionHistoryState,
    sanitize_action_history_state,
} from '../models/ActionHistoryState';

const DOC_PREFIX_ROOT = 'root';
const MAX_HISTORY = 200;

export const actionHistoryStore = createStore<ActionHistoryState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'actionHistory', {
        hydrateMissing: () => ({ entries: [] }),
    }),
    initialData: defaultActionHistoryState,
    sanitize: sanitize_action_history_state,
});

export function pushActionHistoryEntry(entry: ActionHistoryEntry): string[] {
    return pushActionHistoryEntries([entry]);
}

export function pushActionHistoryEntries(entriesToAdd: readonly ActionHistoryEntry[]): string[] {
    const state = actionHistoryStore.value;
    if (!state) {
        return [];
    }
    const unbounded_entries = [...state.entries, ...entriesToAdd];
    const evicted_entry_count = Math.max(0, unbounded_entries.length - MAX_HISTORY);
    const evicted_entry_ids = unbounded_entries.slice(0, evicted_entry_count).map((history_entry) => history_entry.id);
    const entries = unbounded_entries.slice(evicted_entry_count);
    actionHistoryStore.set({ entries });
    return evicted_entry_ids;
}

type MarkEntryRevertedInput = {
    entryId: string;
    expectedFingerprint: string;
};

type MarkEntryRevertedOutput = { status: 'marked' } | { status: 'unavailable' };

function get_action_history_entry_fingerprint(entry: ActionHistoryEntry): string {
    return JSON.stringify([
        entry.id,
        entry.label,
        entry.actionKind,
        entry.source,
        entry.timestamp,
        entry.groupId ?? null,
        entry.groupLabel ?? null,
    ]);
}

export function markEntryReverted({ entryId, expectedFingerprint }: MarkEntryRevertedInput): MarkEntryRevertedOutput {
    const state = actionHistoryStore.value;
    if (!state) {
        return { status: 'unavailable' };
    }
    const current_entry = state.entries.find(
        (entry) => entry.id === entryId && get_action_history_entry_fingerprint(entry) === expectedFingerprint
    );
    if (!current_entry) {
        return { status: 'unavailable' };
    }
    actionHistoryStore.set({
        entries: state.entries.map((event) =>
            event.id === entryId && get_action_history_entry_fingerprint(event) === expectedFingerprint
                ? { ...event, reverted: true }
                : event
        ),
    });
    return { status: 'marked' };
}
