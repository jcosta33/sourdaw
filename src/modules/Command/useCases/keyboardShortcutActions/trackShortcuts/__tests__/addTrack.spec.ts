import { describe, it, expect } from 'vitest';
import * as subject from '../addTrack';

describe('addTrack', () => {
    it('should export addTrack', () => {
        expect(subject.addTrack).toBeDefined();
        const t = typeof subject.addTrack;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
