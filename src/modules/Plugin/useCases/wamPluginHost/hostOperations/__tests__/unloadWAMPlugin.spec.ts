import { describe, it, expect } from 'vitest';

import * as subject from '../unloadWAMPlugin';

describe('unloadWAMPlugin', () => {
    it('should export unloadWAMPlugin', () => {
        expect(subject.unloadWAMPlugin).toBeDefined();
        const time = typeof subject.unloadWAMPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
