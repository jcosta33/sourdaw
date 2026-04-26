import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, type ProcessingNode } from '#/modules/Plugin/stores/nodeView';

import { connectNodes } from '../connectNodes';

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

describe('connectNodes', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [node('na'), node('nb')],
            connections: [],
        });
    });

    it('should add a connection when endpoints differ and it is new', () => {
        connectNodes('na', 0, 'nb', 1);
        const conns = nodeViewStore.value?.connections ?? [];
        expect(conns).toHaveLength(1);
        expect(conns[0]?.fromNodeId).toBe('na');
        expect(conns[0]?.toNodeId).toBe('nb');
        expect(conns[0]?.fromOutput).toBe(0);
        expect(conns[0]?.toInput).toBe(1);
        expect(conns[0]?.id).toMatch(/^conn-[a-f0-9-]+$/);
    });

    it('should not add a duplicate connection with the same endpoints', () => {
        connectNodes('na', 0, 'nb', 0);
        connectNodes('na', 0, 'nb', 0);
        expect(nodeViewStore.value?.connections).toHaveLength(1);
    });

    it('should not connect a node to itself', () => {
        connectNodes('na', 0, 'na', 0);
        expect(nodeViewStore.value?.connections).toHaveLength(0);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        connectNodes('a', 0, 'b', 0);
        expect(nodeViewStore.value).toBeNull();
    });
});
