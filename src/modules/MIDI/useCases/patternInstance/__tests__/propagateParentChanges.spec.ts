import { describe, it, expect } from 'vitest';
import * as subject from '../propagateParentChanges';

describe('propagateParentChanges', () => {
    it('should export propagateParentChanges', () => {
        expect(subject.propagateParentChanges).toBeDefined();
        const t = typeof subject.propagateParentChanges;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
