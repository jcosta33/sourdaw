import { describe, it, expect, beforeEach } from 'vitest';
import { automationStore } from '../../stores/automationStore';
import { getAutomationStoreState } from '../getAutomationStoreState';

describe('getAutomationStoreState', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('should return the current automation store snapshot', () => {
        const next = { lanes: [] };
        automationStore.set(next);
        expect(getAutomationStoreState()).toBe(next);
    });

    it('should return null when the store is not initialized', () => {
        automationStore.set(null);
        expect(getAutomationStoreState()).toBeNull();
    });
});
