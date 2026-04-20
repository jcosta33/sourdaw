import { describe, it, expect } from 'vitest';

import * as subject from '../soundPresetLibrary';

describe('soundPresetLibrary', () => {
    it('should export getFactoryPresets', () => {
        expect(subject.getFactoryPresets).toBeDefined();
        const t = typeof subject.getFactoryPresets;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
