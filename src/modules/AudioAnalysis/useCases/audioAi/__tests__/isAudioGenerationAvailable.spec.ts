import { describe, it, expect } from 'vitest';

import * as subject from '../isAudioGenerationAvailable';

describe('isAudioGenerationAvailable', () => {
    it('should export isAudioGenerationAvailable', () => {
        expect(subject.isAudioGenerationAvailable).toBeDefined();
        const t = typeof subject.isAudioGenerationAvailable;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
