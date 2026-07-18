import { describe, it, expect } from 'vitest';

import * as subject from '../closePluginGui';

describe('closePluginGui', () => {
    it('should export closePluginGui', () => {
        expect(subject.closePluginGui).toBeDefined();
        const time = typeof subject.closePluginGui;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
