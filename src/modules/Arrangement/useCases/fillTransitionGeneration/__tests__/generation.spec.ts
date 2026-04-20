import { describe, it, expect } from 'vitest';

import * as subject from '../generation';

describe('generation', () => {
    it('should export detectTransitionPoints', () => {
        expect(subject.detectTransitionPoints).toBeDefined();
        const t = typeof subject.detectTransitionPoints;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export generateAllTransitionFills', () => {
        expect(subject.generateAllTransitionFills).toBeDefined();
        const t = typeof subject.generateAllTransitionFills;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export generateDrumFill', () => {
        expect(subject.generateDrumFill).toBeDefined();
        const t = typeof subject.generateDrumFill;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export generateRiser', () => {
        expect(subject.generateRiser).toBeDefined();
        const t = typeof subject.generateRiser;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export generateSweepDown', () => {
        expect(subject.generateSweepDown).toBeDefined();
        const t = typeof subject.generateSweepDown;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
