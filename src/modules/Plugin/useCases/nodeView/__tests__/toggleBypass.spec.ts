import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore, type ProcessingNode } from '#/modules/Plugin/stores/nodeView';

import { toggleBypass } from '../toggleBypass';

function node(id: string, bypassed: boolean): ProcessingNode {
    return {
        id,
        type: 'effect',
        label: id,
        deviceId: null,
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        bypassed,
        color: '#000',
    };
}

describe('toggleBypass', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [node('n1', false), node('n2', true)],
            connections: [],
        });
    });

    it('should flip bypass only on the matching node', () => {
        toggleBypass('n1');
        expect(nodeViewStore.value?.nodes.find((node1) => node1.id === 'n1')?.bypassed).toBe(true);
        expect(nodeViewStore.value?.nodes.find((node1) => node1.id === 'n2')?.bypassed).toBe(true);
        toggleBypass('n2');
        expect(nodeViewStore.value?.nodes.find((node1) => node1.id === 'n2')?.bypassed).toBe(false);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        toggleBypass('n1');
        expect(nodeViewStore.value).toBeNull();
    });
});
