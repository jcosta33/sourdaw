import { describe, it, expect, vi, beforeEach } from 'vitest';

import { transportStore } from '../../../stores/transportStore';
import { getTransportState } from '../getTransportState';

vi.mock('../../../stores/transportStore', () => {
    const internal = { value: { tempo: 120, playing: false } };
    return {
        transportStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value) => {
                internal.value = value;
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
