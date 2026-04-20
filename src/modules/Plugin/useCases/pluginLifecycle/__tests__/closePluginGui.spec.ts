import { describe, it, expect } from 'vitest';

import * as subject from '../closePluginGui';

describe('closePluginGui', () => {
    it('should export closePluginGui', () => {
        expect(subject.closePluginGui).toBeDefined();
        const t = typeof subject.closePluginGui;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
