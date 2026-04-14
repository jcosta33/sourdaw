import { describe, it, expect } from 'vitest';
import * as subject from '../updateTempoChange';

describe('updateTempoChange', () => {
    it('should export updateTempoChange', () => {
        expect(subject.updateTempoChange).toBeDefined();
        const t = typeof subject.updateTempoChange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
