import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, type ProcessingNode } from '#/modules/Routing/stores/nodeView';

import { moveNode } from '../moveNode';

function node(id: string): ProcessingNode {
    return {
        id,
        type: 'effect',
        label: id,
        deviceId: null,
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        bypassed: false,
        color: '#000',
    };
}

describe('moveNode', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [node('only')],
            connections: [],
        });
    });

    it('should update x and y for the matching node', () => {
        moveNode('only', 12.5, -4);
        const node1 = nodeViewStore.value?.nodes[0];
        expect(node1?.x).toBe(12.5);
        expect(node1?.y).toBe(-4);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        moveNode('only', 1, 2);
        expect(nodeViewStore.value).toBeNull();
    });

    it('leaves non-matching nodes untouched when moving one of several', () => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [node('a'), node('b')],
            connections: [],
        });

        moveNode('a', 30, 40);

        const [nodeA, nodeB] = nodeViewStore.value?.nodes ?? [];
        expect(nodeA).toMatchObject({ id: 'a', x: 30, y: 40 });
        expect(nodeB).toMatchObject({ id: 'b', x: 0, y: 0 });
    });
});
