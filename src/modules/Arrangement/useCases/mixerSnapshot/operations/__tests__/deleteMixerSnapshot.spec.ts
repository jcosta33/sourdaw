import { describe, it, expect } from 'vitest';

import * as subject from '../deleteMixerSnapshot';

describe('deleteMixerSnapshot', () => {
    it('should export deleteMixerSnapshot', () => {
        expect(subject.deleteMixerSnapshot).toBeDefined();
        const time = typeof subject.deleteMixerSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
