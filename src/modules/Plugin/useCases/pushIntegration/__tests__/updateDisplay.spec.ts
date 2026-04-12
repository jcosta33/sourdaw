import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '#/modules/Plugin/stores/push';

import { updateDisplay } from '../updateDisplay';

describe('updateDisplay', () => {
    beforeEach(() => {
        pushStore.set({
            ...pushStore.value!,
            display: { lines: ['', '', '', ''] },
        });
    });

    it('should replace one display line and truncate to 68 characters', () => {
        const long = 'x'.repeat(80);
        updateDisplay(1, long);
        const line = pushStore.value?.display.lines[1];
        expect(line?.length).toBe(68);
        expect(line).toBe('x'.repeat(68));
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        updateDisplay(0, 'hi');
        expect(pushStore.value).toBeNull();
    });
});
