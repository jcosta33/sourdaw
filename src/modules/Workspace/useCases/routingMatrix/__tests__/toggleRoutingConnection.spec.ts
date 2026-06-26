import { describe, it, expect, beforeEach } from 'vitest';

import { routingConnectionKey, routingMatrixStore } from '../../../stores/routingMatrixStore';
import { toggleRoutingConnection } from '../toggleRoutingConnection';

describe('toggleRoutingConnection write boundary', () => {
    beforeEach(() => {
        routingMatrixStore.set({ connections: {} });
    });

    it('adds a unit-level connection when none exists', () => {
        toggleRoutingConnection('src-1', 'master');
        const key = routingConnectionKey('src-1', 'master');
        expect(routingMatrixStore.value?.connections[key]).toEqual({
            sourceId: 'src-1',
            destId: 'master',
            level: 1.0,
        });
    });

    it('removes the connection when toggled a second time', () => {
        toggleRoutingConnection('src-1', 'master');
        toggleRoutingConnection('src-1', 'master');
        expect(routingMatrixStore.value?.connections).toEqual({});
    });

    it('leaves other connections untouched', () => {
        toggleRoutingConnection('src-1', 'bus-a');
        toggleRoutingConnection('src-2', 'bus-b');
        toggleRoutingConnection('src-1', 'bus-a');
        const keyB = routingConnectionKey('src-2', 'bus-b');
        expect(Object.keys(routingMatrixStore.value?.connections ?? {})).toEqual([keyB]);
    });
});
