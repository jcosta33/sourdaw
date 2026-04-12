import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '#/modules/Plugin/stores/push';

import { handlePadPress } from '../handlePadPress';

describe('handlePadPress', () => {
    beforeEach(() => {
        pushStore.set({ ...pushStore.value! });
    });

    it('should set velocity on the pad with the matching index', () => {
        handlePadPress(5, 100);
        expect(pushStore.value?.pads[5]?.velocity).toBe(100);
        expect(pushStore.value?.pads[4]?.velocity).toBe(0);
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        handlePadPress(0, 64);
        expect(pushStore.value).toBeNull();
    });
});
