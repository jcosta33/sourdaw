import { describe, it, expect } from 'vitest';

import * as subject from '../glueClips';

describe('glueClips', () => {
    it('should export glueClips', () => {
        expect(subject.glueClips).toBeDefined();
        const t = typeof subject.glueClips;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
