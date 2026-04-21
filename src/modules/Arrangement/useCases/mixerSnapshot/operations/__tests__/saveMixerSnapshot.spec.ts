import { describe, it, expect } from 'vitest';

import * as subject from '../saveMixerSnapshot';

describe('saveMixerSnapshot', () => {
    it('should export saveMixerSnapshot', () => {
        expect(subject.saveMixerSnapshot).toBeDefined();
        const time = typeof subject.saveMixerSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
