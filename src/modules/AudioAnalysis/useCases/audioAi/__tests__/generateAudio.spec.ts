import { describe, it, expect } from 'vitest';

import * as subject from '../generateAudio';

describe('generateAudio', () => {
    it('should export generateAudio', () => {
        expect(subject.generateAudio).toBeDefined();
        const t = typeof subject.generateAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
