import { describe, it, expect } from 'vitest';
import * as subject from '../unwireSidechainRoute';

describe('unwireSidechainRoute', () => {
    it('should export unwireSidechainRoute', () => {
        expect(subject.unwireSidechainRoute).toBeDefined();
        const t = typeof subject.unwireSidechainRoute;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
