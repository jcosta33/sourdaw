import { describe, it, expect } from 'vitest';

import * as subject from '../loadProject';

describe('loadProject', () => {
    it('should export loadProject', () => {
        expect(subject.loadProject).toBeDefined();
        const t = typeof subject.loadProject;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
