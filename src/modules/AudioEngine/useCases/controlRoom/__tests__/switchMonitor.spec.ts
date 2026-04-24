import { describe, it, expect } from 'vitest';

import * as subject from '../switchMonitor';

describe('switchMonitor', () => {
    it('should export switchMonitor', () => {
        expect(subject.switchMonitor).toBeDefined();
        const time = typeof subject.switchMonitor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
