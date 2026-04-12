import { describe, it, expect, vi } from 'vitest';
import { getTrackLatency } from '../compensation/helpers';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        getTrackStoreState: vi.fn().mockReturnValue(null),
    }
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getTrackStoreState: mocks.getTrackStoreState,
    };
});

describe('getTrackLatency', () => {
    it('returns zero latency when track state is unavailable', () => {
        expect(getTrackLatency('track-a')).toEqual({
            trackId: 'track-a',
            deviceLatencyMs: 0,
            totalLatencyMs: 0,
        });
    });
});
