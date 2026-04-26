import { describe, it, expect } from 'vitest';

import * as subject from '../assignTrackToVCA';

describe('assignTrackToVCA', () => {
    it('should export assignTrackToVCA', () => {
        expect(subject.assignTrackToVCA).toBeDefined();
        const time = typeof subject.assignTrackToVCA;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
