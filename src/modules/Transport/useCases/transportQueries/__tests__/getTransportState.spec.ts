import { describe, it, expect, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../getTransportState';

const mocks = vi.hoisted(() => ({
    transportStoreValue: { value: null as TransportState | null },
}));

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: () => mocks.transportStoreValue.value,
}));

describe('getTransportState', () => {
    it('returns the value from repository', () => {
        mocks.transportStoreValue.value = { ...defaultTransportState, isPlaying: true };
        expect(getTransportState()).toEqual({ ...defaultTransportState, isPlaying: true });
    });
});
