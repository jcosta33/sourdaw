import { describe, it, expect } from 'vitest';

import * as subject from '../setStretchMode';

describe('setStretchMode', () => {
    it('should export setStretchMode', () => {
        expect(subject.setStretchMode).toBeDefined();
        const time = typeof subject.setStretchMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
