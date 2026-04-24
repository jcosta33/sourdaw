import { describe, it, expect } from 'vitest';

import * as subject from '../setSidechainRoutes';

describe('setSidechainRoutes', () => {
    it('should export setSidechainRoutes', () => {
        expect(subject.setSidechainRoutes).toBeDefined();
        const time = typeof subject.setSidechainRoutes;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
