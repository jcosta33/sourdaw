import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore, PAD_MODE_COLORS } from '../../../stores/push';
import { setPadMode } from '../setPadMode';

describe('setPadMode', () => {
    beforeEach(() => {
        pushStore.set({
            ...pushStore.value!,
            padMode: 'session',
        });
    });

    it('should set pad mode and apply the palette color to every pad in one write', () => {
        setPadMode('scale');
        const state = pushStore.value!;
        expect(state.padMode).toBe('scale');
        const expected = PAD_MODE_COLORS.scale;
        expect(
            state.pads.every(
                (param) => param.color.r === expected.r && param.color.g === expected.g && param.color.b === expected.b
            )
        ).toBe(true);
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        setPadMode('drum');
        expect(pushStore.value).toBeNull();
    });
});
