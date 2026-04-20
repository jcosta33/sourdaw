import { describe, it, expect } from 'vitest';

import * as subject from '../loadPlugin';

describe('loadPlugin', () => {
    it('should export loadPlugin', () => {
        expect(subject.loadPlugin).toBeDefined();
        const t = typeof subject.loadPlugin;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
