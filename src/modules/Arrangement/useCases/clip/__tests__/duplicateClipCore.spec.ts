import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClipCore';

describe('duplicateClipCore', () => {
    it('should export duplicateClipCore', () => {
        expect(subject.duplicateClipCore).toBeDefined();
        const t = typeof subject.duplicateClipCore;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
