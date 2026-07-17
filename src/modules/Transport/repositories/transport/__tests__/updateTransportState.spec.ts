import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { transportStore } from '../../../stores/transportStore';
import { updateTransportState } from '../updateTransportState';

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

describe('updateTransportState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ ...defaultTransportState, tempo: 120, isPlaying: false });
    });

    it('should merge patch into store', () => {
        updateTransportState({ isPlaying: true });
        expect(transportStore.set).toHaveBeenCalledWith({ ...defaultTransportState, tempo: 120, isPlaying: true });
        expect(transportStore.value?.isPlaying).toBe(true);
    });

    it('should do nothing if store is empty', () => {
        transportStore.set(null);
        vi.clearAllMocks();

        updateTransportState({ isPlaying: true });
        expect(transportStore.set).not.toHaveBeenCalled();
    });
});
