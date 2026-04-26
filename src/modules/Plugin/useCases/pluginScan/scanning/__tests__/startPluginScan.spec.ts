import { describe, it, expect } from 'vitest';

import * as subject from '../startPluginScan';

describe('startPluginScan', () => {
    it('should export startPluginScan', () => {
        expect(subject.startPluginScan).toBeDefined();
        const time = typeof subject.startPluginScan;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
