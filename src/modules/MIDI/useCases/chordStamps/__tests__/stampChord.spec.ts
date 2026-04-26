import { describe, it, expect } from 'vitest';

import * as subject from '../stampChord';

describe('stampChord', () => {
    it('should export stampChord', () => {
        expect(subject.stampChord).toBeDefined();
        const time = typeof subject.stampChord;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
