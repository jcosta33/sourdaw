import { describe, it, expect } from 'vitest';

import * as subject from '../setSoloMode';

describe('setSoloMode', () => {
    it('should export setSoloMode', () => {
        expect(subject.setSoloMode).toBeDefined();
        const time = typeof subject.setSoloMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
