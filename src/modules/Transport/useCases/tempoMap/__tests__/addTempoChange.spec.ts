import { describe, it, expect } from 'vitest';

import * as subject from '../addTempoChange';

describe('addTempoChange', () => {
    it('should export addTempoChange', () => {
        expect(subject.addTempoChange).toBeDefined();
        const time = typeof subject.addTempoChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
