import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '../../../stores/push';

import { mapEncoder } from '../mapEncoder';

describe('mapEncoder', () => {
    beforeEach(() => {
        pushStore.set({ ...pushStore.value! });
    });

    it('should set parameter path and label on the matching encoder', () => {
        mapEncoder(2, '/track/1/volume', 'Volume');
        const enc = pushStore.value?.encoders[2];
        expect(enc?.parameterPath).toBe('/track/1/volume');
        expect(enc?.label).toBe('Volume');
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        mapEncoder(0, '/x', 'X');
        expect(pushStore.value).toBeNull();
    });
});
