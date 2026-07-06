import { describe, it, expect, vi } from 'vitest';

import { getTrackLatency } from '../compensation/getTrackLatency';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        trackStore: { value: null },
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();

    return {
        ...actual,
        trackStore: mocks.trackStore,
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
