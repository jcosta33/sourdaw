import { describe, it, expect } from 'vitest';

import * as subject from '../detectTempo';

describe('detectTempo', () => {
    it('should export detectTempo', () => {
        expect(subject.detectTempo).toBeDefined();
        const time = typeof subject.detectTempo;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
