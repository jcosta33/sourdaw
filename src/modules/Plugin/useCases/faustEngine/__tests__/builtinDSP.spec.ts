import { describe, it, expect } from 'vitest';

import * as subject from '../builtinDSP';

describe('builtinDSP', () => {
    it('should export registerBuiltinFaustDSP', () => {
        expect(subject.registerBuiltinFaustDSP).toBeDefined();
        const time = typeof subject.registerBuiltinFaustDSP;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
