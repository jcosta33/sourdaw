import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

import { setViewport } from '../setViewport';

describe('setViewport', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            panX: 0,
            panY: 0,
            zoom: 1,
        });
    });

    it('should set pan and clamp zoom between 0.25 and 4', () => {
        setViewport(12, -3, 10);
        expect(nodeViewStore.value?.panX).toBe(12);
        expect(nodeViewStore.value?.panY).toBe(-3);
        expect(nodeViewStore.value?.zoom).toBe(4);
        setViewport(0, 0, 0.1);
        expect(nodeViewStore.value?.zoom).toBe(0.25);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        setViewport(1, 2, 1.5);
        expect(nodeViewStore.value).toBeNull();
    });
});
