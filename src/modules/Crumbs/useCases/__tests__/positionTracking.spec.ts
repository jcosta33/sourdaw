import { describe, it, expect } from 'vitest';
import * as subject from '../positionTracking';

describe('positionTracking', () => {
    it('should export getInterpolatedPosition', () => {
        expect(subject.getInterpolatedPosition).toBeDefined();
        const t = typeof subject.getInterpolatedPosition;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export subscribeToPosition', () => {
        expect(subject.subscribeToPosition).toBeDefined();
        const t = typeof subject.subscribeToPosition;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
