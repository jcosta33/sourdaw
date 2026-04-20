import { describe, it, expect } from 'vitest';

import * as subject from '../panicGrandBoule';

describe('panicGrandBoule', () => {
    it('should export panicGrandBoule', () => {
        expect(subject.panicGrandBoule).toBeDefined();
        const t = typeof subject.panicGrandBoule;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
