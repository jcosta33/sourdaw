import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '../../../stores/push';

import { handlePadRelease } from '../handlePadRelease';

describe('handlePadRelease', () => {
    beforeEach(() => {
        const state = pushStore.value!;
        const pads = state.pads.map((param) => (param.index === 2 ? { ...param, velocity: 100 } : param));
        pushStore.set({ ...state, pads });
    });

    it('should zero velocity on the targeted pad only', () => {
        handlePadRelease(2);
        expect(pushStore.value?.pads[2]?.velocity).toBe(0);
        expect(pushStore.value?.pads[3]?.velocity).toBe(0);
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        handlePadRelease(0);
        expect(pushStore.value).toBeNull();
    });
});
