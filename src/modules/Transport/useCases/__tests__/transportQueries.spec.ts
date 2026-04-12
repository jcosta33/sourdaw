import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTransportState } from '../transportQueries/getTransportState';
import { getTransportStoreValue } from '../transportQueries/getTransportStoreValue';
import { getTempoMapState } from '../transportQueries/getTempoMapState';
import { updateTransportState } from '../transportQueries/updateTransportState';
import { defaultTransportState } from '../../models/TransportState';
import { type TransportState } from '../../models/TransportState';
import { getTransportState as repoGetTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState as repoUpdateTransportState } from '../../repositories/transport/updateTransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';

vi.mock('../../repositories/transport/getTransportState');
vi.mock('../../repositories/transport/updateTransportState');
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: null },
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

    it('should forward getTransportStoreValue to the same repository accessor', () => {
        const snapshot: TransportState = { ...defaultTransportState, tempo: 77 };
        vi.mocked(repoGetTransportState).mockReturnValue(snapshot);

        expect(getTransportStoreValue()).toBe(snapshot);
        expect(repoGetTransportState).toHaveBeenCalledTimes(1);
    });

    it('should forward updateTransportState patches to the repository', () => {
        updateTransportState({ tempo: 140 });

        expect(repoUpdateTransportState).toHaveBeenCalledWith({ tempo: 140 });
    });

    it('should forward getTempoMapState to the tempo map store', () => {
        const snapshot = { changes: [{ beat: 0, bpm: 120 }] };
        tempoMapStore.value = snapshot as any;

        expect(getTempoMapState()).toBe(snapshot);
    });
});
