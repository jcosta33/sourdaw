import { describe, it, expect } from 'vitest';
import * as subject from '../removeSidechainRoute';

describe('removeSidechainRoute', () => {
    it('should export removeSidechainRoute', () => {
        expect(subject.removeSidechainRoute).toBeDefined();
        const t = typeof subject.removeSidechainRoute;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
