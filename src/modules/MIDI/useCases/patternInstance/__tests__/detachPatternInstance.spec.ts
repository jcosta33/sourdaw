import { describe, it, expect } from 'vitest';
import * as subject from '../detachPatternInstance';

describe('detachPatternInstance', () => {
    it('should export detachPatternInstance', () => {
        expect(subject.detachPatternInstance).toBeDefined();
        const t = typeof subject.detachPatternInstance;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
