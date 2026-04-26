import { describe, it, expect } from 'vitest';

import * as subject from '../recallMixerSnapshot';

describe('recallMixerSnapshot', () => {
    it('should export recallMixerSnapshot', () => {
        expect(subject.recallMixerSnapshot).toBeDefined();
        const time = typeof subject.recallMixerSnapshot;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
