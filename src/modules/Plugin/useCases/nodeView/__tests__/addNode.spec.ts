import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, NODE_COLORS } from '#/modules/Plugin/stores/nodeView';

import { addNode } from '../addNode';

describe('addNode', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [],
            connections: [],
        });
    });

    it('should append a node with layout defaults and a type color', () => {
        addNode('instrument', 'Synth', 10, 20, 'dev-1');
        const n = nodeViewStore.value?.nodes.at(-1);
        expect(nodeViewStore.value?.nodes).toHaveLength(1);
        expect(n?.type).toBe('instrument');
        expect(n?.label).toBe('Synth');
        expect(n?.x).toBe(10);
        expect(n?.y).toBe(20);
        expect(n?.deviceId).toBe('dev-1');
        expect(n?.width).toBe(120);
        expect(n?.height).toBe(60);
        expect(n?.bypassed).toBe(false);
        expect(n?.color).toBe(NODE_COLORS.instrument);
        expect(n?.id).toMatch(/^node-[a-f0-9-]+$/);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        addNode('effect', 'FX', 0, 0);
        expect(nodeViewStore.value).toBeNull();
    });
});
