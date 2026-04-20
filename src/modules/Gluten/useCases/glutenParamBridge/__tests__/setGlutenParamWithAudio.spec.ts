import { describe, it, expect } from 'vitest';

import * as subject from '../setGlutenParamWithAudio';

describe('setGlutenParamWithAudio', () => {
    it('should export setGlutenParamWithAudio', () => {
        expect(subject.setGlutenParamWithAudio).toBeDefined();
        const t = typeof subject.setGlutenParamWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
