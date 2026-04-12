import { describe, it, expect, beforeEach } from 'vitest';
import { aiStore, getAiSnapshot, subscribeAiStore, type AiState } from '../aiStore';

describe('aiStore', () => {
    beforeEach(() => {
        aiStore.set({ tasks: [], isPanelOpen: false });
    });

    it('initializes with empty tasks and closed panel', () => {
        const state = aiStore.value;
        expect(state?.tasks).toEqual([]);
        expect(state?.isPanelOpen).toBe(false);
    });

    it('getAiSnapshot returns the current state or initial state', () => {
        let snapshot = getAiSnapshot();
        expect(snapshot.tasks).toEqual([]);
        expect(snapshot.isPanelOpen).toBe(false);

        const newState: AiState = {
            tasks: [{ id: 't1', type: 'midi-generation', status: 'success', timestamp: 123 }],
            isPanelOpen: true,
        };
        aiStore.set(newState);

        snapshot = getAiSnapshot();
        expect(snapshot).toEqual(newState);
    });

    it('subscribeAiStore registers a callback', () => {
        let called = false;
        const unsubscribe = subscribeAiStore(() => {
            called = true;
        });

        aiStore.set({ tasks: [], isPanelOpen: true });
        expect(called).toBe(true);

        unsubscribe();
    });
});
