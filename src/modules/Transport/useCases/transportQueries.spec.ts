import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    getTransportState,
    getTransportStoreValue,
    getTempoMapState,
    updateTransportState,
} from './transportQueries';
import { defaultTransportState } from '../models/TransportState';
import { type TransportState } from '../models/TransportState';

describe('transportQueries injectables', () => {
    it('should forward getTransportState to the repository', () => {
        const snapshot: TransportState = { ...defaultTransportState, tempo: 99 };
        const repoGet = vi.fn(() => snapshot);
        injectDependencies(getTransportState, { repoGetTransportState: repoGet });

        expect(getTransportState()).toBe(snapshot);
        expect(repoGet).toHaveBeenCalledTimes(1);
    });

    it('should forward getTransportStoreValue to the same repository accessor', () => {
        const snapshot: TransportState = { ...defaultTransportState, tempo: 77 };
        const repoGet = vi.fn(() => snapshot);
        injectDependencies(getTransportStoreValue, { repoGetTransportState: repoGet });

        expect(getTransportStoreValue()).toBe(snapshot);
        expect(repoGet).toHaveBeenCalledTimes(1);
    });

    it('should forward updateTransportState patches to the repository', () => {
        const repoUpdate = vi.fn();
        injectDependencies(updateTransportState, { repoUpdateTransportState: repoUpdate });

        updateTransportState({ tempo: 140 });

        expect(repoUpdate).toHaveBeenCalledWith({ tempo: 140 });
    });

    it('should forward getTempoMapState to the tempo map store', () => {
        const snapshot = { changes: [{ beat: 0, bpm: 120 }] };
        const tempoMapStoreStub = { value: snapshot };
        injectDependencies(getTempoMapState, { tempoMapStore: tempoMapStoreStub as never });

        expect(getTempoMapState()).toBe(snapshot);
    });
});
