import { describe, it, expect } from 'vitest';

import * as subject from '../loadWAMPlugin';

describe('loadWAMPlugin', () => {
    it('should export loadWAMPlugin', () => {
        expect(subject.loadWAMPlugin).toBeDefined();
        const t = typeof subject.loadWAMPlugin;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
