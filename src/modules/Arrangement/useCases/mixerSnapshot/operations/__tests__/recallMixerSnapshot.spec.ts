import { describe, it, expect } from 'vitest';

import * as subject from '../recallMixerSnapshot';

describe('recallMixerSnapshot', () => {
    it('should export recallMixerSnapshot', () => {
        expect(subject.recallMixerSnapshot).toBeDefined();
        const t = typeof subject.recallMixerSnapshot;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
