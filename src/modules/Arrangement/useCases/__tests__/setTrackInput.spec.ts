import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackInput';

describe('setTrackInput', () => {
    it('should export setTrackInput', () => {
        expect(subject.setTrackInput).toBeDefined();
        const t = typeof subject.setTrackInput;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
