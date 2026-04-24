import { describe, it, expect } from 'vitest';

import * as subject from '../loadExternalPlugin';

describe('loadExternalPlugin', () => {
    it('should export loadExternalPlugin', () => {
        expect(subject.loadExternalPlugin).toBeDefined();
        const time = typeof subject.loadExternalPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
