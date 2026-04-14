import { describe, it, expect } from 'vitest';
import * as subject from '../assignTrackToVCA';

describe('assignTrackToVCA', () => {
    it('should export assignTrackToVCA', () => {
        expect(subject.assignTrackToVCA).toBeDefined();
        const t = typeof subject.assignTrackToVCA;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
