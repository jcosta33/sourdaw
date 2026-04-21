import { describe, it, expect } from 'vitest';

import * as subject from '../getUserPresets';

describe('getUserPresets', () => {
    it('should export getUserPresets', () => {
        expect(subject.getUserPresets).toBeDefined();
        const time = typeof subject.getUserPresets;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
