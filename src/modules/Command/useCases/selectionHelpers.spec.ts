import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getSelectedTrackId } from './selectionHelpers/getSelectedTrackId';

describe('getSelectedTrackId', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when track state is unavailable', () => {
        const getTrackStoreState = vi.fn().mockReturnValue(null);
        const getMarkerState = vi.fn();
        const getTransportStoreValue = vi.fn();
        const seekPlayhead = vi.fn();
        const getWorkspaceState = vi.fn();
        injectDependencies(getSelectedTrackId, {
            getTrackStoreState,
            getMarkerState,
            getTransportStoreValue,
            seekPlayhead,
            getWorkspaceState,
        });

        expect(getSelectedTrackId()).toBeNull();
    });
});
