import { describe, it, expect } from 'vitest';

import * as subject from '../getSnapshot';

describe('getSnapshot', () => {
    it('should export getSnapshot', () => {
        expect(subject.getSnapshot).toBeDefined();
        const time = typeof subject.getSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
