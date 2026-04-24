import { describe, it, expect } from 'vitest';

import * as subject from '../openInspector';

describe('openInspector', () => {
    it('should export openInspector', () => {
        expect(subject.openInspector).toBeDefined();
        const time = typeof subject.openInspector;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
