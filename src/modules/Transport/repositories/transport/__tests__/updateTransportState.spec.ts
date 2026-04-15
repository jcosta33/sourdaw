import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTransportState } from '../updateTransportState';
import { transportStore } from '../../../stores/transportStore';

vi.mock('../../../stores/transportStore', () => {
    const internal = { value: { tempo: 120, playing: false } as { tempo: number; playing: boolean } | null };
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

describe('updateTransportState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        transportStore.set({ tempo: 120, playing: false });
    });

    it('should merge patch into store', () => {
        updateTransportState({ playing: true });
        expect(transportStore.set).toHaveBeenCalledWith({ tempo: 120, playing: true });
        expect(transportStore.value?.playing).toBe(true);
    });

    it('should do nothing if store is empty', () => {
        transportStore.set(null as unknown as { tempo: number; playing: boolean });
        vi.clearAllMocks();

        updateTransportState({ playing: true });
        expect(transportStore.set).not.toHaveBeenCalled();
    });
});
