import { describe, it, expect } from 'vitest';

import * as subject from '../setStretchMode';

describe('setStretchMode', () => {
    it('should export setStretchMode', () => {
        expect(subject.setStretchMode).toBeDefined();
        const t = typeof subject.setStretchMode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
