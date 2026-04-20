import { describe, it, expect } from 'vitest';

import * as subject from '../renameMixerSnapshot';

describe('renameMixerSnapshot', () => {
    it('should export renameMixerSnapshot', () => {
        expect(subject.renameMixerSnapshot).toBeDefined();
        const t = typeof subject.renameMixerSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
