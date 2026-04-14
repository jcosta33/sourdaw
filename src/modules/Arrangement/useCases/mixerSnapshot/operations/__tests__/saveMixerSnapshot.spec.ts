import { describe, it, expect } from 'vitest';
import * as subject from '../saveMixerSnapshot';

describe('saveMixerSnapshot', () => {
    it('should export saveMixerSnapshot', () => {
        expect(subject.saveMixerSnapshot).toBeDefined();
        const t = typeof subject.saveMixerSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
