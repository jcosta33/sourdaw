import { describe, it, expect } from 'vitest';

import * as subject from '../setTrackOutput';

describe('setTrackOutput', () => {
    it('should export setTrackOutput', () => {
        expect(subject.setTrackOutput).toBeDefined();
        const time = typeof subject.setTrackOutput;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
