import { describe, it, expect } from 'vitest';
import * as subject from '../wireSidechainRoute';

describe('wireSidechainRoute', () => {
    it('should export wireSidechainRoute', () => {
        expect(subject.wireSidechainRoute).toBeDefined();
        const t = typeof subject.wireSidechainRoute;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
