import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateClip';

describe('duplicateClip', () => {
    it('should export duplicateClip', () => {
        expect(subject.duplicateClip).toBeDefined();
        const time = typeof subject.duplicateClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
