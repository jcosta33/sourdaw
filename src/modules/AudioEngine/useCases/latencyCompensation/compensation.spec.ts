import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getTrackLatency } from './compensation';

describe('getTrackLatency', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns zero latency when track state is unavailable', () => {
        const getTrackStoreState = vi.fn().mockReturnValue(null);
        injectDependencies(getTrackLatency, { getTrackStoreState });

        expect(getTrackLatency('track-a')).toEqual({
            trackId: 'track-a',
            deviceLatencyMs: 0,
            totalLatencyMs: 0,
        });
    });
});
