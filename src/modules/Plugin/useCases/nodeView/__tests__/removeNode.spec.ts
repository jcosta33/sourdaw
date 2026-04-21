import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, type ProcessingNode } from '#/modules/Plugin/stores/nodeView';

import { removeNode } from '../removeNode';

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

describe('removeNode', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [node('a'), node('b')],
            connections: [
                { id: 'c1', fromNodeId: 'a', fromOutput: 0, toNodeId: 'b', toInput: 0 },
                { id: 'c2', fromNodeId: 'b', fromOutput: 0, toNodeId: 'a', toInput: 0 },
            ],
        });
    });

    it('should remove the node and any connection touching it', () => {
        removeNode('a');
        expect(nodeViewStore.value?.nodes.map((n) => n.id)).toEqual(['b']);
        expect(nodeViewStore.value?.connections).toEqual([]);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        removeNode('a');
        expect(nodeViewStore.value).toBeNull();
    });
});
