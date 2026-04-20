import { describe, it, expect } from 'vitest';

import * as subject from '../rescanRoot';

describe('rescanRoot', () => {
    it('should export rescanRoot', () => {
        expect(subject.rescanRoot).toBeDefined();
        const t = typeof subject.rescanRoot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
