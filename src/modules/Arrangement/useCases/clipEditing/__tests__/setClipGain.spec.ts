import { describe, it, expect } from 'vitest';

import * as subject from '../setClipGain';

describe('setClipGain', () => {
    it('should export setClipGain', () => {
        expect(subject.setClipGain).toBeDefined();
        const time = typeof subject.setClipGain;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
