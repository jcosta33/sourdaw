import { describe, it, expect } from 'vitest';

import * as subject from '../deleteTime';

describe('deleteTime', () => {
    it('should export deleteTime', () => {
        expect(subject.deleteTime).toBeDefined();
        const time = typeof subject.deleteTime;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
