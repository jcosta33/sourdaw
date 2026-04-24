import { describe, it, expect } from 'vitest';

import * as subject from '../recordAction';

describe('recordAction', () => {
    it('should export recordAction', () => {
        expect(subject.recordAction).toBeDefined();
        const time = typeof subject.recordAction;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
