import { describe, it, expect } from 'vitest';

import * as subject from '../removeTempoChange';

describe('removeTempoChange', () => {
    it('should export removeTempoChange', () => {
        expect(subject.removeTempoChange).toBeDefined();
        const time = typeof subject.removeTempoChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
