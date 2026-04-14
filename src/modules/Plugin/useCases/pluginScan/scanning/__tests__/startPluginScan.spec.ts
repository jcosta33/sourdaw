import { describe, it, expect } from 'vitest';
import * as subject from '../startPluginScan';

describe('startPluginScan', () => {
    it('should export startPluginScan', () => {
        expect(subject.startPluginScan).toBeDefined();
        const t = typeof subject.startPluginScan;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
