import { describe, it, expect } from 'vitest';

import * as subject from '../transformSelectedPoints';

describe('transformSelectedPoints', () => {
    it('should export transformSelectedPoints', () => {
        expect(subject.transformSelectedPoints).toBeDefined();
        const time = typeof subject.transformSelectedPoints;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
