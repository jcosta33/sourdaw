import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getWarpState', () => {
        expect(subject.getWarpState).toBeDefined();
        const time = typeof subject.getWarpState;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
