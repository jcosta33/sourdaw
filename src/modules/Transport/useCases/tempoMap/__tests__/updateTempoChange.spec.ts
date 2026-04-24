import { describe, it, expect } from 'vitest';

import * as subject from '../updateTempoChange';

describe('updateTempoChange', () => {
    it('should export updateTempoChange', () => {
        expect(subject.updateTempoChange).toBeDefined();
        const time = typeof subject.updateTempoChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
