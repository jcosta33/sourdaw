import { describe, it, expect } from 'vitest';

import * as subject from '../unregisterProofDevice';

describe('unregisterProofDevice', () => {
    it('should export unregisterProofDevice', () => {
        expect(subject.unregisterProofDevice).toBeDefined();
        const t = typeof subject.unregisterProofDevice;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
