import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type AppAction } from '#/modules/Command/models/AppAction';

const logger = Container.getInstance().get(Logger);

export type AiActionGroup = {
    id: string;
    prompt: string;
    actions: Array<{ action: AppAction; label: string }>;
    groupId: string;
    timestamp: number;
    reverted: boolean;
};

export type AiActionHistoryState = {
    groups: AiActionGroup[];
    panelOpen: boolean;
};

export const aiActionHistoryStore = new Store<AiActionHistoryState>(logger, {
    initialData: { groups: [], panelOpen: false },
});

const MAX_HISTORY = 50;

export function pushAiActionGroup(group: AiActionGroup): void {
    const state = aiActionHistoryStore.value;
    if (!state) {
        return;
    }
    const groups = [...state.groups, group].slice(-MAX_HISTORY);
    aiActionHistoryStore.set({ ...state, groups, panelOpen: true });
}

export function markGroupReverted(groupId: string): void {
    const state = aiActionHistoryStore.value;
    if (!state) {
        return;
    }
    aiActionHistoryStore.set({
        ...state,
        groups: state.groups.map((g) => (g.groupId === groupId ? { ...g, reverted: true } : g)),
    });
}

export function toggleAiHistoryPanel(): void {
    const state = aiActionHistoryStore.value;
    if (!state) {
        return;
    }
    aiActionHistoryStore.set({ ...state, panelOpen: !state.panelOpen });
}

export function clearAiHistory(): void {
    const state = aiActionHistoryStore.value;
    if (!state) {
        return;
    }
    aiActionHistoryStore.set({ ...state, groups: [] });
}
