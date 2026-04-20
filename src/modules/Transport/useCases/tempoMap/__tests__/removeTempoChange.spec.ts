import { describe, it, expect } from 'vitest';

import * as subject from '../removeTempoChange';

describe('removeTempoChange', () => {
    it('should export removeTempoChange', () => {
        expect(subject.removeTempoChange).toBeDefined();
        const t = typeof subject.removeTempoChange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
