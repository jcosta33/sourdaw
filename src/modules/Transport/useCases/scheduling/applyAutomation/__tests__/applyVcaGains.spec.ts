import { describe, it, expect } from 'vitest';

import * as subject from '../applyVcaGains';

describe('applyVcaGains', () => {
    it('should export applyVcaGains', () => {
        expect(subject.applyVcaGains).toBeDefined();
        const time = typeof subject.applyVcaGains;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
