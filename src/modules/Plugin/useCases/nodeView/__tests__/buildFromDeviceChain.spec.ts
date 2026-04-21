import { describe, it, expect, beforeEach } from 'vitest';

import { nodeViewStore } from '#/modules/Plugin/stores/nodeView';

import { buildFromDeviceChain } from '../buildFromDeviceChain';

describe('buildFromDeviceChain', () => {
    beforeEach(() => {
        nodeViewStore.set({
            ...nodeViewStore.value!,
            nodes: [],
            connections: [],
            activeTrackId: null,
        });
    });

    it('should build input and output only when the device list is empty', () => {
        buildFromDeviceChain('track-a', []);
        const state = nodeViewStore.value!;
        expect(state.activeTrackId).toBe('track-a');
        expect(state.nodes.map((node) => node.type)).toEqual(['input', 'output']);
        expect(state.connections).toHaveLength(1);
    });

    it('should chain devices between input and output', () => {
        buildFromDeviceChain('track-b', [
            { id: 'd1', name: 'EQ' },
            { id: 'd2', name: 'Comp' },
        ]);
        const state = nodeViewStore.value!;
        expect(state.nodes.map((node) => node.type)).toEqual(['input', 'effect', 'effect', 'output']);
        expect(state.nodes[1]?.deviceId).toBe('d1');
        expect(state.nodes[2]?.deviceId).toBe('d2');
        expect(state.connections).toHaveLength(3);
    });

    it('should not mutate when node view store is null', () => {
        nodeViewStore.set(null);
        buildFromDeviceChain('x', [{ id: 'd', name: 'D' }]);
        expect(nodeViewStore.value).toBeNull();
    });
});
