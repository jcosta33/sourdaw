import { describe, it, expect } from 'vitest';

import * as subject from '../proModulationEffects';

describe('proModulationEffects', () => {
    it('should export registerProModulationEffects', () => {
        expect(subject.registerProModulationEffects).toBeDefined();
        const time = typeof subject.registerProModulationEffects;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
