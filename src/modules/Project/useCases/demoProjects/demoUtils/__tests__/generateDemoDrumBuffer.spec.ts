import { describe, it, expect } from 'vitest';

import * as subject from '../generateDemoDrumBuffer';

describe('generateDemoDrumBuffer', () => {
    it('should export createNoiseBurst', () => {
        expect(subject.createNoiseBurst).toBeDefined();
        const t = typeof subject.createNoiseBurst;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export generateDemoDrumBuffer', () => {
        expect(subject.generateDemoDrumBuffer).toBeDefined();
        const t = typeof subject.generateDemoDrumBuffer;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
