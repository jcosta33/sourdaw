import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '../../../stores/push';

import { setEncoderValue } from '../setEncoderValue';

describe('setEncoderValue', () => {
    beforeEach(() => {
        pushStore.set({ ...pushStore.value! });
    });

    it('should clamp encoder values to 0–127', () => {
        setEncoderValue(0, 200);
        expect(pushStore.value?.encoders[0]?.value).toBe(127);
        setEncoderValue(0, -5);
        expect(pushStore.value?.encoders[0]?.value).toBe(0);
    });

    it('should leave other encoders unchanged', () => {
        const before1 = pushStore.value?.encoders[1]?.value;
        setEncoderValue(3, 42);
        expect(pushStore.value?.encoders[1]?.value).toBe(before1);
        expect(pushStore.value?.encoders[3]?.value).toBe(42);
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        setEncoderValue(0, 64);
        expect(pushStore.value).toBeNull();
    });
});
