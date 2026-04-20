import { describe, it, expect } from 'vitest';

import * as subject from '../setFermenterParamWithAudio';

describe('setFermenterParamWithAudio', () => {
    it('should export setFermenterParamWithAudio', () => {
        expect(subject.setFermenterParamWithAudio).toBeDefined();
        const t = typeof subject.setFermenterParamWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
