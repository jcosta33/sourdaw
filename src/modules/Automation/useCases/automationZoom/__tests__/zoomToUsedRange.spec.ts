import { describe, it, expect } from 'vitest';

import * as subject from '../zoomToUsedRange';

describe('zoomToUsedRange', () => {
    it('should export zoomToUsedRange', () => {
        expect(subject.zoomToUsedRange).toBeDefined();
        const t = typeof subject.zoomToUsedRange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
