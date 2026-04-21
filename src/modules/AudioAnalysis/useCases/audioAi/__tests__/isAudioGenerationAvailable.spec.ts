import { describe, it, expect } from 'vitest';

import * as subject from '../isAudioGenerationAvailable';

describe('isAudioGenerationAvailable', () => {
    it('should export isAudioGenerationAvailable', () => {
        expect(subject.isAudioGenerationAvailable).toBeDefined();
        const time = typeof subject.isAudioGenerationAvailable;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
