import { describe, it, expect } from 'vitest';

import * as subject from '../acceptGhostClip';

describe('acceptGhostClip', () => {
    it('should export acceptGhostClip', () => {
        expect(subject.acceptGhostClip).toBeDefined();
        const time = typeof subject.acceptGhostClip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
