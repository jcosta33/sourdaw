import { describe, it, expect } from 'vitest';

import * as subject from '../mcuSetMode';

describe('mcuSetMode', () => {
    it('should export mcuSetMode', () => {
        expect(subject.mcuSetMode).toBeDefined();
        const t = typeof subject.mcuSetMode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
