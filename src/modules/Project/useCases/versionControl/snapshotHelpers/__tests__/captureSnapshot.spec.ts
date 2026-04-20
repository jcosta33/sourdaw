import { describe, it, expect } from 'vitest';

import * as subject from '../captureSnapshot';

describe('captureSnapshot', () => {
    it('should export captureSnapshot', () => {
        expect(subject.captureSnapshot).toBeDefined();
        const t = typeof subject.captureSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
