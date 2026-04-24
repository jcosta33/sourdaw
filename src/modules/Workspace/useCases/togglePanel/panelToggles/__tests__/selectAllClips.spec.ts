import { describe, it, expect } from 'vitest';

import * as subject from '../selectAllClips';

describe('selectAllClips', () => {
    it('should export selectAllClips', () => {
        expect(subject.selectAllClips).toBeDefined();
        const time = typeof subject.selectAllClips;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
