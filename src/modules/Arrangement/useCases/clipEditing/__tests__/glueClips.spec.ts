import { describe, it, expect } from 'vitest';

import * as subject from '../glueClips';

describe('glueClips', () => {
    it('should export glueClips', () => {
        expect(subject.glueClips).toBeDefined();
        const time = typeof subject.glueClips;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
