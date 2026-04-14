import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getWarpState', () => {
        expect(subject.getWarpState).toBeDefined();
        const t = typeof subject.getWarpState;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
