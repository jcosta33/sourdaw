import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClipCore';

describe('duplicateClipCore', () => {
    it('should export duplicateClipCore', () => {
        expect(subject.duplicateClipCore).toBeDefined();
        const time = typeof subject.duplicateClipCore;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
