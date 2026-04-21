import { describe, it, expect } from 'vitest';

import * as subject from '../generateDemoDrumBuffer';

describe('generateDemoDrumBuffer', () => {
    it('should export createNoiseBurst', () => {
        expect(subject.createNoiseBurst).toBeDefined();
        const time = typeof subject.createNoiseBurst;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export generateDemoDrumBuffer', () => {
        expect(subject.generateDemoDrumBuffer).toBeDefined();
        const time = typeof subject.generateDemoDrumBuffer;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
