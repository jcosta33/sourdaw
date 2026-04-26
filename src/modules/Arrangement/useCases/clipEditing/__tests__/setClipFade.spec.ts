import { describe, it, expect } from 'vitest';

import * as subject from '../setClipFade';

describe('setClipFade', () => {
    it('should export setClipFade', () => {
        expect(subject.setClipFade).toBeDefined();
        const time = typeof subject.setClipFade;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
