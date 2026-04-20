import { describe, it, expect } from 'vitest';

import * as subject from '../setSidechainRoutes';

describe('setSidechainRoutes', () => {
    it('should export setSidechainRoutes', () => {
        expect(subject.setSidechainRoutes).toBeDefined();
        const t = typeof subject.setSidechainRoutes;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
