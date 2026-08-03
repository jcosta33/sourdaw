import { stringify } from 'superjson';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    aiActionHistoryStore,
    type AiActionHistoryState,
    pushAiActionGroup,
    markGroupReverted,
    toggleAiHistoryPanel,
    clearAiHistory,
} from '../aiActionHistoryStore';

async function loadHistoryStateFromStoredValue(storedValue: unknown): Promise<AiActionHistoryState | null> {
    vi.resetModules();
    window.localStorage.setItem('sourdaw-ai-history', stringify(storedValue));

    const module = await import('../aiActionHistoryStore');
    return module.aiActionHistoryStore.value;
}

async function loadHistoryStateFromRawStoredValue(storedValue: string): Promise<AiActionHistoryState | null> {
    vi.resetModules();
    window.localStorage.setItem('sourdaw-ai-history', storedValue);

    const module = await import('../aiActionHistoryStore');
    return module.aiActionHistoryStore.value;
}

describe('aiActionHistoryStore', () => {
    beforeEach(() => {
        aiActionHistoryStore.set({ groups: [], panelOpen: false });
    });

    it('initializes with empty groups and closed panel', () => {
        const state = aiActionHistoryStore.value;
        expect(state?.groups).toEqual([]);
        expect(state?.panelOpen).toBe(false);
    });

    describe('persisted hydration', () => {
        it('should default corrupt stored state instead of hydrating raw invalid shape', async () => {
            const state = await loadHistoryStateFromStoredValue({
                groups: 'not-groups',
                panelOpen: 'yes',
            });

            expect(state).toEqual({ groups: [], panelOpen: false });
        });

        it('should default null, non-object, and missing stored state fields', async () => {
            await expect(loadHistoryStateFromStoredValue(null)).resolves.toEqual({ groups: [], panelOpen: false });
            await expect(loadHistoryStateFromStoredValue(123)).resolves.toEqual({ groups: [], panelOpen: false });
            await expect(loadHistoryStateFromStoredValue({})).resolves.toEqual({ groups: [], panelOpen: false });
        });

        it('should default malformed raw local storage text', async () => {
            await expect(loadHistoryStateFromRawStoredValue('{not-json')).resolves.toEqual({
                groups: [],
                panelOpen: false,
            });
        });

        it('should preserve valid stored groups and panel visibility', async () => {
            const validState = {
                groups: [
                    {
                        id: 'history-1',
                        prompt: 'Add a bassline',
                        groupId: 'group-1',
                        timestamp: 123,
                        reverted: false,
                        actions: [{ kind: 'appAction', actionType: 'track.create', label: 'Create track' }],
                    },
                ],
                panelOpen: true,
            };

            const state = await loadHistoryStateFromStoredValue(validState);

            expect(state).toEqual(validState);
        });

        it('should discard legacy JSON-edit groups while preserving AppAction groups', async () => {
            const validGroup = {
                id: 'history-1',
                prompt: 'Keep this one',
                groupId: 'group-1',
                timestamp: 123,
                reverted: false,
                actions: [{ kind: 'appAction', actionType: 'track.create', label: 'Create track' }],
            };

            const state = await loadHistoryStateFromStoredValue({
                groups: [
                    {
                        id: 'legacy-history',
                        prompt: 'Retired JSON edit',
                        groupId: 'legacy-group',
                        timestamp: 122,
                        reverted: false,
                        actions: [{ kind: 'jsonEdit', label: 'Edit project JSON' }],
                    },
                    validGroup,
                ],
                panelOpen: true,
            });

            expect(state).toEqual({ groups: [validGroup], panelOpen: true });
        });

        it('should default invalid top-level fields independently', async () => {
            const state = await loadHistoryStateFromStoredValue({
                groups: 'not-groups',
                panelOpen: true,
            });

            expect(state).toEqual({ groups: [], panelOpen: true });
        });

        it('should drop invalid groups including groups with invalid action entries', async () => {
            const validGroup = {
                id: 'history-1',
                prompt: 'Keep this one',
                groupId: 'group-1',
                timestamp: 123,
                reverted: false,
                actions: [{ kind: 'appAction', actionType: 'track.create', label: 'Create track' }],
            };

            const state = await loadHistoryStateFromStoredValue({
                groups: [
                    validGroup,
                    {
                        id: 'history-2',
                        prompt: 'Missing finite timestamp',
                        groupId: 'group-2',
                        timestamp: Number.NaN,
                        reverted: false,
                        actions: [{ kind: 'appAction', actionType: 'track.create', label: 'Create track' }],
                    },
                    {
                        id: 'history-3',
                        prompt: 'Invalid action entry',
                        groupId: 'group-3',
                        timestamp: 456,
                        reverted: false,
                        actions: [{ kind: 'appAction', actionType: 'track.create' }],
                    },
                ],
                panelOpen: 'not-boolean',
            });

            expect(state).toEqual({ groups: [validGroup], panelOpen: false });
        });
    });

    describe('pushAiActionGroup', () => {
        it('appends a new group and opens the panel', () => {
            const group = {
                id: 'g1',
                prompt: 'test prompt',
                actions: [],
                groupId: 'g1',
                timestamp: 123,
                reverted: false,
            };

            pushAiActionGroup(group);

            const state = aiActionHistoryStore.value!;
            expect(state.groups).toHaveLength(1);
            expect(state.groups[0]).toEqual(group);
            expect(state.panelOpen).toBe(true);
        });

        it('limits history to 50 groups', () => {
            for (let index = 0; index < 55; index++) {
                pushAiActionGroup({
                    id: `g${index}`,
                    prompt: 'test prompt',
                    actions: [],
                    groupId: `g${index}`,
                    timestamp: index,
                    reverted: false,
                });
            }

            const state = aiActionHistoryStore.value!;
            expect(state.groups).toHaveLength(50);
            expect(state.groups[0]!.id).toBe('g5');
            expect(state.groups[49]!.id).toBe('g54');
        });
    });

    describe('markGroupReverted', () => {
        it('marks the specified group as reverted', () => {
            pushAiActionGroup({
                id: 'g1',
                prompt: 'test prompt',
                actions: [],
                groupId: 'g1',
                timestamp: 123,
                reverted: false,
            });

            markGroupReverted('g1');

            expect(aiActionHistoryStore.value!.groups[0]!.reverted).toBe(true);
        });

        it('does nothing if group is not found', () => {
            pushAiActionGroup({
                id: 'g1',
                prompt: 'test',
                actions: [],
                groupId: 'g1',
                timestamp: 1,
                reverted: false,
            });

            markGroupReverted('missing');

            expect(aiActionHistoryStore.value!.groups[0]!.reverted).toBe(false);
        });
    });

    describe('toggleAiHistoryPanel', () => {
        it('toggles the panel visibility state', () => {
            expect(aiActionHistoryStore.value!.panelOpen).toBe(false);

            toggleAiHistoryPanel();
            expect(aiActionHistoryStore.value!.panelOpen).toBe(true);

            toggleAiHistoryPanel();
            expect(aiActionHistoryStore.value!.panelOpen).toBe(false);
        });
    });

    describe('clearAiHistory', () => {
        it('empties the groups array', () => {
            pushAiActionGroup({
                id: 'g1',
                prompt: 'test',
                actions: [],
                groupId: 'g1',
                timestamp: 1,
                reverted: false,
            });

            clearAiHistory();

            expect(aiActionHistoryStore.value!.groups).toEqual([]);
        });
    });
});
