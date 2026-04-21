import { describe, it, expect } from 'vitest';

import * as subject from '../setSend';

describe('setSend', () => {
    it('should export setSend', () => {
        expect(subject.setSend).toBeDefined();
        const time = typeof subject.setSend;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
