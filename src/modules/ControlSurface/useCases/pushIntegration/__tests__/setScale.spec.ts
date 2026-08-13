import { describe, it, expect, beforeEach } from 'vitest';

import { pushStore } from '../../../stores/push';
import { setScale } from '../setScale';

describe('setScale', () => {
    beforeEach(() => {
        pushStore.set({
            ...pushStore.value!,
            rootNote: 0,
            scaleName: 'Major',
        });
    });

    it('should wrap root note to 0–11 and set scale name', () => {
        setScale(14, 'dorian');
        expect(pushStore.value?.rootNote).toBe(2);
        expect(pushStore.value?.scaleName).toBe('dorian');
    });

    it('should not mutate when push store is null', () => {
        pushStore.set(null);
        setScale(3, 'minor');
        expect(pushStore.value).toBeNull();
    });

    it('should wrap a negative root note into 0-11 using a positive modulo (F-7)', () => {
        setScale(-1, 'minor');
        expect(pushStore.value?.rootNote).toBe(11);
    });

    it('should wrap a negative root note that is an exact negative multiple of 12', () => {
        setScale(-12, 'minor');
        expect(pushStore.value?.rootNote).toBe(0);
    });
});
