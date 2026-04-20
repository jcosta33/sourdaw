import { describe, it, expect } from 'vitest';

import * as subject from '../subscribe';

describe('subscribe', () => {
    it('should export subscribe', () => {
        expect(subject.subscribe).toBeDefined();
        const t = typeof subject.subscribe;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
