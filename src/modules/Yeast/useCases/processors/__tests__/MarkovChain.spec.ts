import { describe, it, expect } from 'vitest';

import * as subject from '../MarkovChain';

describe('MarkovChain', () => {
    it('should export MarkovChain', () => {
        expect(subject.MarkovChain).toBeDefined();
        const time = typeof subject.MarkovChain;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
