import { describe, it, expect } from 'vitest';

import * as subject from '../soundPresetLibrary';

describe('soundPresetLibrary', () => {
    it('should export getFactoryPresets', () => {
        expect(subject.getFactoryPresets).toBeDefined();
        const time = typeof subject.getFactoryPresets;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
