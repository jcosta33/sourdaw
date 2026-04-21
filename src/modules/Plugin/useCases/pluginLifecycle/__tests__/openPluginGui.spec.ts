import { describe, it, expect } from 'vitest';

import * as subject from '../openPluginGui';

describe('openPluginGui', () => {
    it('should export openPluginGui', () => {
        expect(subject.openPluginGui).toBeDefined();
        const time = typeof subject.openPluginGui;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
