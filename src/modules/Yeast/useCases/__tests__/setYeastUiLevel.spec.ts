import { describe, it, expect, beforeEach } from 'vitest';
import { yeastStore } from '../../stores/yeastStore';
import { setYeastUiLevel } from '../setYeastUiLevel';

describe('setYeastUiLevel', () => {
    beforeEach(() => {
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    it('should update uiLevel when the yeast store is initialized', () => {
        setYeastUiLevel(4);

        expect(yeastStore.value?.uiLevel).toBe(4);
    });

    it('should not throw when the store is null', () => {
        yeastStore.set(null);
        expect(() => setYeastUiLevel(3)).not.toThrow();
    });
});
