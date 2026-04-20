import { describe, it, expect } from 'vitest';

import * as subject from '../getSidechainSource';

describe('getSidechainSource', () => {
    it('should export getSidechainSource', () => {
        expect(subject.getSidechainSource).toBeDefined();
        const t = typeof subject.getSidechainSource;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
