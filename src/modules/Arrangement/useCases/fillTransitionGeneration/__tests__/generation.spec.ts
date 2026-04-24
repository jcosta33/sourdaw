import { describe, it, expect } from 'vitest';

import * as subject from '../generation';

describe('generation', () => {
    it('should export detectTransitionPoints', () => {
        expect(subject.detectTransitionPoints).toBeDefined();
        const time = typeof subject.detectTransitionPoints;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export generateAllTransitionFills', () => {
        expect(subject.generateAllTransitionFills).toBeDefined();
        const time = typeof subject.generateAllTransitionFills;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export generateDrumFill', () => {
        expect(subject.generateDrumFill).toBeDefined();
        const time = typeof subject.generateDrumFill;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export generateRiser', () => {
        expect(subject.generateRiser).toBeDefined();
        const time = typeof subject.generateRiser;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export generateSweepDown', () => {
        expect(subject.generateSweepDown).toBeDefined();
        const time = typeof subject.generateSweepDown;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
