import { describe, it, expect } from 'vitest';

import * as subject from '../registerProofDevice';

describe('registerProofDevice', () => {
    it('should export registerProofDevice', () => {
        expect(subject.registerProofDevice).toBeDefined();
        const t = typeof subject.registerProofDevice;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
