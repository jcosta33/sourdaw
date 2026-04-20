import { describe, it, expect } from 'vitest';

import * as subject from '../addExternalDevice';

describe('addExternalDevice', () => {
    it('should export addExternalDevice', () => {
        expect(subject.addExternalDevice).toBeDefined();
        const t = typeof subject.addExternalDevice;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
