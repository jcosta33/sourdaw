import { describe, it, expect } from 'vitest';
import * as subject from '../setCueTrackLevel';

describe('setCueTrackLevel', () => {
    it('should export setCueTrackLevel', () => {
        expect(subject.setCueTrackLevel).toBeDefined();
        const t = typeof subject.setCueTrackLevel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
