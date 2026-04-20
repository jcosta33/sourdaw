import { describe, it, expect } from 'vitest';

import * as subject from '../renameProject';

describe('renameProject', () => {
    it('should export renameProject', () => {
        expect(subject.renameProject).toBeDefined();
        const t = typeof subject.renameProject;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
