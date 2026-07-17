import { describe, it, expect } from 'vitest';

import * as subject from '../captureSnapshot';

describe('captureSnapshot', () => {
    it('should export captureSnapshot', () => {
        expect(subject.captureSnapshot).toBeDefined();
        const time = typeof subject.captureSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
