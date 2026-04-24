import { describe, it, expect } from 'vitest';

import * as subject from '../zoomToUsedRange';

describe('zoomToUsedRange', () => {
    it('should export zoomToUsedRange', () => {
        expect(subject.zoomToUsedRange).toBeDefined();
        const time = typeof subject.zoomToUsedRange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
