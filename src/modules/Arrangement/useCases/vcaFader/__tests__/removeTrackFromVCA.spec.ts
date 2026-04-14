import { describe, it, expect } from 'vitest';
import * as subject from '../removeTrackFromVCA';

describe('removeTrackFromVCA', () => {
    it('should export removeTrackFromVCA', () => {
        expect(subject.removeTrackFromVCA).toBeDefined();
        const t = typeof subject.removeTrackFromVCA;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
