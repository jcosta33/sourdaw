import { describe, it, expect } from 'vitest';
import * as subject from '../stampChord';

describe('stampChord', () => {
    it('should export stampChord', () => {
        expect(subject.stampChord).toBeDefined();
        const t = typeof subject.stampChord;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
