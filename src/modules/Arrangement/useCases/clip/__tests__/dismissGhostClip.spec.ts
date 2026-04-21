import { describe, it, expect } from 'vitest';

import * as subject from '../dismissGhostClip';

describe('dismissGhostClip', () => {
    it('should export dismissGhostClip', () => {
        expect(subject.dismissGhostClip).toBeDefined();
        const time = typeof subject.dismissGhostClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
