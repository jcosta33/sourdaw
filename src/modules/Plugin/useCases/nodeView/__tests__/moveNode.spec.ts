import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, type ProcessingNode } from '#/modules/Plugin/stores/nodeView';

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
        const n = nodeViewStore.value?.nodes[0];
        expect(n?.x).toBe(12.5);
        expect(n?.y).toBe(-4);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        moveNode('only', 1, 2);
        expect(nodeViewStore.value).toBeNull();
    });
});
