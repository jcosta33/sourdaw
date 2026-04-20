import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClipToNextBar';

describe('duplicateClipToNextBar', () => {
    it('should export duplicateClipToNextBar', () => {
        expect(subject.duplicateClipToNextBar).toBeDefined();
        const t = typeof subject.duplicateClipToNextBar;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
