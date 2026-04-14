import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTransportState } from '../getTransportState';
import { updateTransportState } from '../updateTransportState';
import { transportStore } from '../../../stores/transportStore';

vi.mock('../../../stores/transportStore', () => {
    const internal = { value: { tempo: 120, playing: false } };
    return {
        transportStore: {
            get value() { return internal.value; },
            set: vi.fn((v) => { internal.value = v; }),
        },
    };
});

describe('transportRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ tempo: 120, playing: false } as any);
    });

    it('getTransportState should return store value', () => {
        const state = getTransportState();
        expect(state).toEqual({ tempo: 120, playing: false });
    });

    it('updateTransportState should merge patch into store', () => {
        updateTransportState({ playing: true });
        expect(transportStore.set).toHaveBeenCalledWith({ tempo: 120, playing: true });
        expect(getTransportState()?.playing).toBe(true);
    });

    it('updateTransportState should do nothing if store is empty', () => {
        // Force value to null for this test
        vi.mocked(transportStore).set(null as any);
        vi.clearAllMocks();
        
        updateTransportState({ playing: true });
        expect(transportStore.set).not.toHaveBeenCalled();
    });
});
