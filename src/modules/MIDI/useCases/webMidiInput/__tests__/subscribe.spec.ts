import { describe, it, expect } from 'vitest';

import * as subject from '../subscribe';

describe('subscribe', () => {
    it('should export subscribe', () => {
        expect(subject.subscribe).toBeDefined();
        const time = typeof subject.subscribe;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
