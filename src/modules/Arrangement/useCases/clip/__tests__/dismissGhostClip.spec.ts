import { describe, it, expect } from 'vitest';

import * as subject from '../dismissGhostClip';

describe('dismissGhostClip', () => {
    it('should export dismissGhostClip', () => {
        expect(subject.dismissGhostClip).toBeDefined();
        const t = typeof subject.dismissGhostClip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
