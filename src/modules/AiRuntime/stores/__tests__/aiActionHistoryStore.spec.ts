import { describe, it, expect, beforeEach } from 'vitest';

import {
    aiActionHistoryStore,
    pushAiActionGroup,
    markGroupReverted,
    toggleAiHistoryPanel,
    clearAiHistory,
} from '../aiActionHistoryStore';

describe('aiActionHistoryStore', () => {
    beforeEach(() => {
        aiActionHistoryStore.set({ groups: [], panelOpen: false });
    });

    it('initializes with empty groups and closed panel', () => {
        const state = aiActionHistoryStore.value;
        expect(state?.groups).toEqual([]);
        expect(state?.panelOpen).toBe(false);
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
