import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, NODE_COLORS } from '#/modules/Routing/stores/nodeView';

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
        const node = nodeViewStore.value?.nodes.at(-1);
        expect(nodeViewStore.value?.nodes).toHaveLength(1);
        expect(node?.type).toBe('instrument');
        expect(node?.label).toBe('Synth');
        expect(node?.x).toBe(10);
        expect(node?.y).toBe(20);
        expect(node?.deviceId).toBe('dev-1');
        expect(node?.width).toBe(120);
        expect(node?.height).toBe(60);
        expect(node?.bypassed).toBe(false);
        expect(node?.color).toBe(NODE_COLORS.instrument);
        expect(node?.id).toMatch(/^node-[a-f0-9-]+$/);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        addNode('effect', 'FX', 0, 0);
        expect(nodeViewStore.value).toBeNull();
    });
});
