import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '../../../stores/push';

import { setPadColor } from '../setPadColor';

describe('setPadColor', () => {
    beforeEach(() => {
        pushStore.set({ ...pushStore.value! });
    });

    it('should update only the targeted pad color', () => {
        const context = { r: 10, g: 20, b: 30 };
        setPadColor(1, context);
        expect(pushStore.value?.pads[1]?.color).toEqual(context);
        expect(pushStore.value?.pads[0]?.color).not.toEqual(context);
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        setPadColor(0, { r: 1, g: 1, b: 1 });
        expect(pushStore.value).toBeNull();
    });
});
