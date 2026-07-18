import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore } from '#/modules/Routing/stores/nodeView';

import { toggleNodeView } from '../toggleNodeView';

describe('toggleNodeView', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            visible: false,
        });
    });

    it('should flip the visible flag', () => {
        toggleNodeView();
        expect(nodeViewStore.value?.visible).toBe(true);
        toggleNodeView();
        expect(nodeViewStore.value?.visible).toBe(false);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        toggleNodeView();
        expect(nodeViewStore.value).toBeNull();
    });
});
