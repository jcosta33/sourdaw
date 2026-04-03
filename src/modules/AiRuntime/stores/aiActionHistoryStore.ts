import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';
import { type AppAction } from '#/modules/Command/useCases/commandQueries';

const logger = Container.getInstance().get(Logger);

export type AiActionEntry =
    | { kind: 'appAction'; action: AppAction; label: string }
    | { kind: 'jsonEdit'; label: string };

export type AiActionGroup = {
    id: string;
    prompt: string;
    actions: AiActionEntry[];
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
    storage: new LocalStorageStorage('sourdaw-ai-history'),
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
