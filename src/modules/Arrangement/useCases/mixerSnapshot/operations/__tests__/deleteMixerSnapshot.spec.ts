import { describe, it, expect } from 'vitest';
import * as subject from '../deleteMixerSnapshot';

describe('deleteMixerSnapshot', () => {
    it('should export deleteMixerSnapshot', () => {
        expect(subject.deleteMixerSnapshot).toBeDefined();
        const t = typeof subject.deleteMixerSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
