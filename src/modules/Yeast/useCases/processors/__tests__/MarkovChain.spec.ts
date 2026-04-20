import { describe, it, expect } from 'vitest';

import * as subject from '../MarkovChain';

describe('MarkovChain', () => {
    it('should export MarkovChain', () => {
        expect(subject.MarkovChain).toBeDefined();
        const t = typeof subject.MarkovChain;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
