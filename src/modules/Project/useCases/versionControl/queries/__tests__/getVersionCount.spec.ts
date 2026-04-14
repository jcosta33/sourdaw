import { describe, it, expect } from 'vitest';
import * as subject from '../getVersionCount';

describe('getVersionCount', () => {
    it('should export getVersionCount', () => {
        expect(subject.getVersionCount).toBeDefined();
        const t = typeof subject.getVersionCount;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
