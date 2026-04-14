import { describe, it, expect, beforeEach } from 'vitest';
import { preferencesStore } from '../preferencesStore';

describe('preferencesStore', () => {
    beforeEach(() => {
        // Reset to a known state if possible, though createStore might be a singleton
        // For unit tests, we mainly care about the store instance behavior
    });

    it('should have initial preferences', () => {
        expect(preferencesStore.value).toBeDefined();
        // Check for some expected default keys from helpers.ts
        expect(preferencesStore.value).toHaveProperty('theme');
        expect(preferencesStore.value).toHaveProperty('autoSave');
    });

    it('should update preferences', () => {
        const original = preferencesStore.value;
        preferencesStore.update((state) => ({
            ...state!,
            theme: 'light'
        }));
        
        expect(preferencesStore.value?.theme).toBe('light');
        
        // Restore
        preferencesStore.set(original);
    });
});
