import { describe, it, expect } from 'vitest';

import * as subject from '../toggleInspector';

describe('toggleInspector', () => {
    it('should export toggleInspector', () => {
        expect(subject.toggleInspector).toBeDefined();
        const time = typeof subject.toggleInspector;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
