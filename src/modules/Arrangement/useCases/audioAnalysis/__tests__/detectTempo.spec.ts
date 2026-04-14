import { describe, it, expect } from 'vitest';
import * as subject from '../detectTempo';

describe('detectTempo', () => {
    it('should export detectTempo', () => {
        expect(subject.detectTempo).toBeDefined();
        const t = typeof subject.detectTempo;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
