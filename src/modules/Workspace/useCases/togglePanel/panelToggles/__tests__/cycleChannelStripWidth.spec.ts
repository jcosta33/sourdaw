import { describe, it, expect } from 'vitest';

import * as subject from '../cycleChannelStripWidth';

describe('cycleChannelStripWidth', () => {
    it('should export cycleChannelStripWidth', () => {
        expect(subject.cycleChannelStripWidth).toBeDefined();
        const time = typeof subject.cycleChannelStripWidth;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
