import { describe, it, expect } from 'vitest';

import * as subject from '../getSidechainSource';

describe('getSidechainSource', () => {
    it('should export getSidechainSource', () => {
        expect(subject.getSidechainSource).toBeDefined();
        const time = typeof subject.getSidechainSource;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
