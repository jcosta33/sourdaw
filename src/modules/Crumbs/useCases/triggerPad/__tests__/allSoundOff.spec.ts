import { describe, it, expect } from 'vitest';

import * as subject from '../allSoundOff';

describe('allSoundOff', () => {
    it('should export allSoundOff', () => {
        expect(subject.allSoundOff).toBeDefined();
        const t = typeof subject.allSoundOff;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
