import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTransportState } from '../getTransportState';
import { transportStore } from '../../../stores/transportStore';

vi.mock('../../../stores/transportStore', () => {
    const internal = { value: { tempo: 120, playing: false } };
    return {
        transportStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((v) => {
                internal.value = v;
            }),
        },
    };
});

describe('getTransportState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ tempo: 120, playing: false } as { tempo: number; playing: boolean });
    });

    it('should return store value', () => {
        const state = getTransportState();
        expect(state).toEqual({ tempo: 120, playing: false });
    });
});
