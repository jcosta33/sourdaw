import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

export type AiActionEntry = { kind: 'appAction'; actionType: string; label: string };

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

type UnknownRecord = {
    [key: string]: unknown;
};

function createDefaultAiActionHistoryState(): AiActionHistoryState {
    return { groups: [], panelOpen: false };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStoredActionEntry(value: unknown): AiActionEntry | null {
    if (!isRecord(value)) {
        return null;
    }

    if (value.kind === 'appAction') {
        if (typeof value.actionType !== 'string' || typeof value.label !== 'string') {
            return null;
        }

        return {
            kind: 'appAction',
            actionType: value.actionType,
            label: value.label,
        };
    }

    return null;
}

function validateStoredActionEntries(values: unknown[]): AiActionEntry[] | null {
    const actions: AiActionEntry[] = [];

    for (const value of values) {
        const action = validateStoredActionEntry(value);
        if (action === null) {
            return null;
        }

        actions.push(action);
    }

    return actions;
}

function validateStoredActionGroup(value: unknown): AiActionGroup | null {
    if (!isRecord(value)) {
        return null;
    }

    if (
        typeof value.id !== 'string' ||
        typeof value.prompt !== 'string' ||
        typeof value.groupId !== 'string' ||
        typeof value.timestamp !== 'number' ||
        !Number.isFinite(value.timestamp) ||
        typeof value.reverted !== 'boolean' ||
        !Array.isArray(value.actions)
    ) {
        return null;
    }

    const actions = validateStoredActionEntries(value.actions);
    if (actions === null) {
        return null;
    }

    return {
        id: value.id,
        prompt: value.prompt,
        actions,
        groupId: value.groupId,
        timestamp: value.timestamp,
        reverted: value.reverted,
    };
}

function validateStoredActionGroups(values: unknown[]): AiActionGroup[] {
    const groups: AiActionGroup[] = [];

    for (const value of values) {
        const group = validateStoredActionGroup(value);
        if (group !== null) {
            groups.push(group);
        }
    }

    return groups;
}

function validateStoredAiActionHistoryState(value: unknown): AiActionHistoryState {
    if (!isRecord(value)) {
        return createDefaultAiActionHistoryState();
    }

    const groups = Array.isArray(value.groups) ? validateStoredActionGroups(value.groups) : [];
    const panelOpen = typeof value.panelOpen === 'boolean' ? value.panelOpen : false;

    return { groups, panelOpen };
}

export const aiActionHistoryStore = createStore<AiActionHistoryState>({
    initialData: createDefaultAiActionHistoryState(),
    storage: createLocalStorage<AiActionHistoryState>('sourdaw-ai-history'),
    sanitize: validateStoredAiActionHistoryState,
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
