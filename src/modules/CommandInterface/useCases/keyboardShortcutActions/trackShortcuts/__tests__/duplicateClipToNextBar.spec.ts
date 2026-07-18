import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClipToNextBar';

describe('duplicateClipToNextBar', () => {
    it('should export duplicateClipToNextBar', () => {
        expect(subject.duplicateClipToNextBar).toBeDefined();
        const time = typeof subject.duplicateClipToNextBar;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
