import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '../../../stores/push';

import { connectPush } from '../connectPush';

describe('connectPush', () => {
    beforeEach(() => {
        pushStore.set({
            ...pushStore.value!,
            connected: false,
            model: null,
        });
    });

    it('should mark connected and set the hardware model', () => {
        connectPush('push3');
        expect(pushStore.value?.connected).toBe(true);
        expect(pushStore.value?.model).toBe('push3');
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        connectPush('push2');
        expect(pushStore.value).toBeNull();
    });
});
