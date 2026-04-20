import { describe, it, expect } from 'vitest';

import * as subject from '../loadExternalPlugin';

describe('loadExternalPlugin', () => {
    it('should export loadExternalPlugin', () => {
        expect(subject.loadExternalPlugin).toBeDefined();
        const t = typeof subject.loadExternalPlugin;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
