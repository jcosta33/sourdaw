import { describe, it, expect } from 'vitest';
import * as subject from '../freezeTrack';

describe('freezeTrack', () => {
    it('should export freezeTrack', () => {
        expect(subject.freezeTrack).toBeDefined();
        const t = typeof subject.freezeTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
