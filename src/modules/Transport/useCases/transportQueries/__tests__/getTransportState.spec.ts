import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTransportState } from '../getTransportState';

const mocks = vi.hoisted(() => ({
    transportStoreValue: { value: null },
}));

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: () => mocks.transportStoreValue.value,
}));

describe('getTransportState', () => {
    it('returns the value from repository', () => {
        mocks.transportStoreValue.value = { isPlaying: true } as any;
        expect(getTransportState()).toEqual({ isPlaying: true });
    });
});
