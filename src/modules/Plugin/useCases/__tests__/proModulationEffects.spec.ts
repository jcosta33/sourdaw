import { describe, it, expect } from 'vitest';
import * as subject from '../proModulationEffects';

describe('proModulationEffects', () => {
    it('should export registerProModulationEffects', () => {
        expect(subject.registerProModulationEffects).toBeDefined();
        const t = typeof subject.registerProModulationEffects;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
