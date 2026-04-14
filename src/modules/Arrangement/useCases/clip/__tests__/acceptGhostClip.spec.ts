import { describe, it, expect } from 'vitest';
import * as subject from '../acceptGhostClip';

describe('acceptGhostClip', () => {
    it('should export acceptGhostClip', () => {
        expect(subject.acceptGhostClip).toBeDefined();
        const t = typeof subject.acceptGhostClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
