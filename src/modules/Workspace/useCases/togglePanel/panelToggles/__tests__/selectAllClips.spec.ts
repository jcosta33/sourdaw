import { describe, it, expect } from 'vitest';
import * as subject from '../selectAllClips';

describe('selectAllClips', () => {
    it('should export selectAllClips', () => {
        expect(subject.selectAllClips).toBeDefined();
        const t = typeof subject.selectAllClips;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
