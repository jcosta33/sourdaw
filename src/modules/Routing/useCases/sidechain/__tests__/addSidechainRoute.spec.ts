import { describe, it, expect } from 'vitest';
import * as subject from '../addSidechainRoute';

describe('addSidechainRoute', () => {
    it('should export addSidechainRoute', () => {
        expect(subject.addSidechainRoute).toBeDefined();
        const t = typeof subject.addSidechainRoute;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
