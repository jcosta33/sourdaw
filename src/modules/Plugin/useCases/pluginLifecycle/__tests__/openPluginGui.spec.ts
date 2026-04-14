import { describe, it, expect } from 'vitest';
import * as subject from '../openPluginGui';

describe('openPluginGui', () => {
    it('should export openPluginGui', () => {
        expect(subject.openPluginGui).toBeDefined();
        const t = typeof subject.openPluginGui;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
