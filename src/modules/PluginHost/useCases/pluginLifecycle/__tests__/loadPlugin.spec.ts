import { describe, it, expect } from 'vitest';

import * as subject from '../loadPlugin';

describe('loadPlugin', () => {
    it('should export loadPlugin', () => {
        expect(subject.loadPlugin).toBeDefined();
        const time = typeof subject.loadPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
