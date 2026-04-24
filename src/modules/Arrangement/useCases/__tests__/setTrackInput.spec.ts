import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackInput';

describe('setTrackInput', () => {
    it('should export setTrackInput', () => {
        expect(subject.setTrackInput).toBeDefined();
        const time = typeof subject.setTrackInput;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
