import { createStore } from '#/infra/store/createStore';
import { type AppAction } from '#/modules/Command/models/AppAction';

export type ActionHistoryEntry = {
    id: string;
    label: string;
    actionKind: string;
    action: AppAction;
    inverseAction: AppAction | null;
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
    initialData: { entries: [] },
});

export const pushActionHistoryEntry = (entry: ActionHistoryEntry): void => {
    const state = actionHistoryStore.value;
    if (!state) {
        return;
    }
    const entries = [...state.entries, entry].slice(-MAX_HISTORY);
    actionHistoryStore.set({ entries });
};

export const markEntryReverted = (entryId: string): void => {
    const state = actionHistoryStore.value;
    if (!state) {
        return;
    }
    actionHistoryStore.set({
        entries: state.entries.map((e) => (e.id === entryId ? { ...e, reverted: true } : e)),
    });
};

export const clearActionHistory = (): void => {
    actionHistoryStore.set({ entries: [] });
};
