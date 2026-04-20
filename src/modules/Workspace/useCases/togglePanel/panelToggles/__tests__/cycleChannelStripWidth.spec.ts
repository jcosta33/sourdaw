import { describe, it, expect } from 'vitest';

import * as subject from '../cycleChannelStripWidth';

describe('cycleChannelStripWidth', () => {
    it('should export cycleChannelStripWidth', () => {
        expect(subject.cycleChannelStripWidth).toBeDefined();
        const t = typeof subject.cycleChannelStripWidth;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
