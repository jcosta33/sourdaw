import { describe, it, expect } from 'vitest';

import * as subject from '../getPluginHostHandlers';

describe('getPluginHostHandlers', () => {
    it('should export getPluginHostHandlers', () => {
        expect(subject.getPluginHostHandlers).toBeDefined();
        const time = typeof subject.getPluginHostHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
