import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateTrack';

describe('duplicateTrack', () => {
    it('should export duplicateTrack', () => {
        expect(subject.duplicateTrack).toBeDefined();
        const time = typeof subject.duplicateTrack;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
