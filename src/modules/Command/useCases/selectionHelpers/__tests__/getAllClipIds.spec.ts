import { describe, it, expect } from 'vitest';
import * as subject from '../getAllClipIds';

describe('getAllClipIds', () => {
    it('should export getAllClipIds', () => {
        expect(subject.getAllClipIds).toBeDefined();
        const t = typeof subject.getAllClipIds;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
