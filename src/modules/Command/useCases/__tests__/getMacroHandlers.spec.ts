import { describe, it, expect } from 'vitest';

import * as subject from '../getMacroHandlers';

describe('getMacroHandlers', () => {
    it('should export getMacroHandlers', () => {
        expect(subject.getMacroHandlers).toBeDefined();
        const time = typeof subject.getMacroHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
