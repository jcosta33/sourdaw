import { describe, it, expect } from 'vitest';

import * as subject from '../saveProject';

describe('saveProject', () => {
    it('should export saveProject', () => {
        expect(subject.saveProject).toBeDefined();
        const t = typeof subject.saveProject;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
