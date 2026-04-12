import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, type ProcessingNode } from '#/modules/Plugin/stores/nodeView';

import { disconnectNodes } from '../disconnectNodes';

const node = (id: string): ProcessingNode => ({
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
});

describe('disconnectNodes', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [node('a'), node('b')],
            connections: [
                { id: 'keep-me', fromNodeId: 'a', fromOutput: 0, toNodeId: 'b', toInput: 0 },
                { id: 'drop-me', fromNodeId: 'b', fromOutput: 0, toNodeId: 'a', toInput: 0 },
            ],
        });
    });

    it('should remove only the connection with the given id', () => {
        disconnectNodes('drop-me');
        const ids = nodeViewStore.value?.connections.map((c) => c.id) ?? [];
        expect(ids).toEqual(['keep-me']);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        disconnectNodes('x');
        expect(nodeViewStore.value).toBeNull();
    });
});
