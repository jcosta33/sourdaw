import { describe, it, expect } from 'vitest';

import * as subject from '../setClipLoopLength';

describe('setClipLoopLength', () => {
    it('should export setClipLoopLength', () => {
        expect(subject.setClipLoopLength).toBeDefined();
        const time = typeof subject.setClipLoopLength;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
