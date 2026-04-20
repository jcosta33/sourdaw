import { describe, it, expect } from 'vitest';

import * as subject from '../setCrustParamWithAudio';

describe('setCrustParamWithAudio', () => {
    it('should export setCrustParamWithAudio', () => {
        expect(subject.setCrustParamWithAudio).toBeDefined();
        const t = typeof subject.setCrustParamWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
