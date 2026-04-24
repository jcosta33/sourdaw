import { describe, it, expect } from 'vitest';

import * as subject from '../mcuSetMode';

describe('mcuSetMode', () => {
    it('should export mcuSetMode', () => {
        expect(subject.mcuSetMode).toBeDefined();
        const time = typeof subject.mcuSetMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
