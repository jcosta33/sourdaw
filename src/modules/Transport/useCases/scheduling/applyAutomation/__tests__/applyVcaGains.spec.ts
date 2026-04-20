import { describe, it, expect } from 'vitest';

import * as subject from '../applyVcaGains';

describe('applyVcaGains', () => {
    it('should export applyVcaGains', () => {
        expect(subject.applyVcaGains).toBeDefined();
        const t = typeof subject.applyVcaGains;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
