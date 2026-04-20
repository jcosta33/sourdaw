import { describe, it, expect } from 'vitest';

import * as subject from '../builtinDSP';

describe('builtinDSP', () => {
    it('should export registerBuiltinFaustDSP', () => {
        expect(subject.registerBuiltinFaustDSP).toBeDefined();
        const t = typeof subject.registerBuiltinFaustDSP;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
