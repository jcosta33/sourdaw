import { describe, it, expect } from 'vitest';

import * as subject from '../setClipLoopLength';

describe('setClipLoopLength', () => {
    it('should export setClipLoopLength', () => {
        expect(subject.setClipLoopLength).toBeDefined();
        const t = typeof subject.setClipLoopLength;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
