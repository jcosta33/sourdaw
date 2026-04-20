import { describe, it, expect } from 'vitest';

import * as subject from '../recordAction';

describe('recordAction', () => {
    it('should export recordAction', () => {
        expect(subject.recordAction).toBeDefined();
        const t = typeof subject.recordAction;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
