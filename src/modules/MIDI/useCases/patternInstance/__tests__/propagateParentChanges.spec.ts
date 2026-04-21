import { describe, it, expect } from 'vitest';

import * as subject from '../propagateParentChanges';

describe('propagateParentChanges', () => {
    it('should export propagateParentChanges', () => {
        expect(subject.propagateParentChanges).toBeDefined();
        const time = typeof subject.propagateParentChanges;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
