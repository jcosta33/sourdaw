import { describe, it, expect } from 'vitest';

import * as subject from '../removeTrackFromVCA';

describe('removeTrackFromVCA', () => {
    it('should export removeTrackFromVCA', () => {
        expect(subject.removeTrackFromVCA).toBeDefined();
        const time = typeof subject.removeTrackFromVCA;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
