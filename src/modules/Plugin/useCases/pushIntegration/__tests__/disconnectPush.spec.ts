import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '#/modules/Plugin/stores/push';

import { disconnectPush } from '../disconnectPush';

describe('disconnectPush', () => {
    beforeEach(() => {
        pushStore.set({
            ...pushStore.value!,
            connected: true,
            model: 'push2',
        });
    });

    it('should clear connection and model', () => {
        disconnectPush();
        expect(pushStore.value?.connected).toBe(false);
        expect(pushStore.value?.model).toBeNull();
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        disconnectPush();
        expect(pushStore.value).toBeNull();
    });
});
