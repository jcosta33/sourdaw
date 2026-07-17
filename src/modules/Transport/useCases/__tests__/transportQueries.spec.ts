import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../models/TransportState';
import { type TransportState } from '../../models/TransportState';
import { getTransportState as repoGetTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState as repoUpdateTransportState } from '../../repositories/transport/updateTransportState';
import { getTempoMapState } from '../transportQueries/getTempoMapState';
import { getTransportState } from '../transportQueries/getTransportState';
import { updateTransportState } from '../transportQueries/updateTransportState';

import type { TempoMapStoreState } from '../../stores/tempoMapStore';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');
const tempoMapStoreMock = vi.hoisted(() => ({
    value: null as import('../../stores/tempoMapStore').TempoMapStoreState | null,
}));

vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: tempoMapStoreMock,
}));

describe('transportQueries injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should forward getTransportState to the repository', () => {
        const snapshot: TransportState = { ...defaultTransportState, tempo: 99 };
        vi.mocked(repoGetTransportState).mockReturnValue(snapshot);

        expect(getTransportState()).toBe(snapshot);
        expect(repoGetTransportState).toHaveBeenCalledTimes(1);
    });

    it('should forward updateTransportState patches to the repository', () => {
        updateTransportState({ tempo: 140 });

        expect(repoUpdateTransportState).toHaveBeenCalledWith({ tempo: 140 });
    });

    it('should forward getTempoMapState to the tempo map store', () => {
        const snapshot: TempoMapStoreState = { changes: [{ id: '1', beat: 0, tempo: 120, curve: 'instant' }] };
        tempoMapStoreMock.value = snapshot;

        expect(getTempoMapState()).toBe(snapshot);
    });
});
