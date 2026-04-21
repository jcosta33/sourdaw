import { describe, it, expect } from 'vitest';

import * as subject from '../detachPatternInstance';

describe('detachPatternInstance', () => {
    it('should export detachPatternInstance', () => {
        expect(subject.detachPatternInstance).toBeDefined();
        const time = typeof subject.detachPatternInstance;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
