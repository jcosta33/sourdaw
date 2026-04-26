import { describe, it, expect } from 'vitest';

import * as subject from '../generateAudio';

describe('generateAudio', () => {
    it('should export generateAudio', () => {
        expect(subject.generateAudio).toBeDefined();
        const time = typeof subject.generateAudio;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
