import { describe, it, expect, beforeEach } from 'vitest';
import { raveStore } from '../../../stores/rave';
import { setTransferBlend } from '../setTransferBlend';

describe('setTransferBlend', () => {
    beforeEach(() => {
        raveStore.set({
            models: [],
            activeModelId: null,
            transferBlend: 0.5,
            temperature: 1,
            realTimeEnabled: false,
            latentCache: [],
        });
    });

    it('should not write when the rave store is null', () => {
        raveStore.set(null);
        setTransferBlend(0.8);
        expect(raveStore.value).toBeNull();
    });

    it('should clamp blend between 0 and 1', () => {
        setTransferBlend(2.5);

        expect(raveStore.value?.transferBlend).toBe(1);
    });
});
