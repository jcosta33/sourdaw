import { describe, it, expect } from 'vitest';
import * as subject from '../getAllSidechainRoutes';

describe('getAllSidechainRoutes', () => {
    it('should export getAllSidechainRoutes', () => {
        expect(subject.getAllSidechainRoutes).toBeDefined();
        const t = typeof subject.getAllSidechainRoutes;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
