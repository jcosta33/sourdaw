import { describe, it, expect } from 'vitest';

import * as subject from '../loadWAMPlugin';

describe('loadWAMPlugin', () => {
    it('should export loadWAMPlugin', () => {
        expect(subject.loadWAMPlugin).toBeDefined();
        const time = typeof subject.loadWAMPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
