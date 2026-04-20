import { describe, it, expect } from 'vitest';

import * as subject from '../setSoloMode';

describe('setSoloMode', () => {
    it('should export setSoloMode', () => {
        expect(subject.setSoloMode).toBeDefined();
        const t = typeof subject.setSoloMode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
