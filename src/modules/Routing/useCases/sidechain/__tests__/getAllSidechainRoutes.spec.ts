import { describe, it, expect } from 'vitest';

import * as subject from '../getAllSidechainRoutes';

describe('getAllSidechainRoutes', () => {
    it('should export getAllSidechainRoutes', () => {
        expect(subject.getAllSidechainRoutes).toBeDefined();
        const time = typeof subject.getAllSidechainRoutes;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
