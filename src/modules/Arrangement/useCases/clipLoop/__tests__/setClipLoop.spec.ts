import { describe, it, expect } from 'vitest';

import * as subject from '../setClipLoop';

describe('setClipLoop', () => {
    it('should export setClipLoop', () => {
        expect(subject.setClipLoop).toBeDefined();
        const time = typeof subject.setClipLoop;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
