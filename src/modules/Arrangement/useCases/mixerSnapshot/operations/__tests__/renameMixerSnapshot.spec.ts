import { describe, it, expect } from 'vitest';

import * as subject from '../renameMixerSnapshot';

describe('renameMixerSnapshot', () => {
    it('should export renameMixerSnapshot', () => {
        expect(subject.renameMixerSnapshot).toBeDefined();
        const time = typeof subject.renameMixerSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
