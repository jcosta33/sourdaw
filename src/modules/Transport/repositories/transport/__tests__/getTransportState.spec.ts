import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { transportStore } from '../../../stores/transportStore';
import { getTransportState } from '../getTransportState';

vi.mock('../../../stores/transportStore', () => {
    const internal = { value: null as import('../../../models/TransportState').TransportState | null };
    return {
        transportStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value: import('../../../models/TransportState').TransportState | null) => {
                internal.value = value;
            }),
        },
    };
});

describe('getTransportState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ ...defaultTransportState, tempo: 120 });
    });

    it('should return store value', () => {
        const state = getTransportState();
        expect(state).toEqual({ ...defaultTransportState, tempo: 120 });
    });
});
