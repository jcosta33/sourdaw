import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type ActionHistoryAction = {
    type: string;
    payload?: unknown;
};

export type ActionHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    action: ActionHistoryAction;
    inverseAction: ActionHistoryAction | null;
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

export const actionHistoryStore = createStore<ActionHistoryState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'actionHistory'),
    initialData: { entries: [] },
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
