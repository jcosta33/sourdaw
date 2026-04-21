import { describe, it, expect } from 'vitest';

import * as subject from '../setCueTrackLevel';

describe('setCueTrackLevel', () => {
    it('should export setCueTrackLevel', () => {
        expect(subject.setCueTrackLevel).toBeDefined();
        const time = typeof subject.setCueTrackLevel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
