import { describe, it, expect } from 'vitest';

import * as subject from '../triggerPadOff';

describe('triggerPadOff', () => {
    it('should export triggerPadOff', () => {
        expect(subject.triggerPadOff).toBeDefined();
        const t = typeof subject.triggerPadOff;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
