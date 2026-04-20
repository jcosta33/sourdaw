import { describe, it, expect } from 'vitest';

import * as subject from '../triggerPadOn';

describe('triggerPadOn', () => {
    it('should export triggerPadOn', () => {
        expect(subject.triggerPadOn).toBeDefined();
        const t = typeof subject.triggerPadOn;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
