import { describe, it, expect } from 'vitest';

import * as subject from '../toggleFolderCollapse';

describe('toggleFolderCollapse', () => {
    it('should export toggleFolderCollapse', () => {
        expect(subject.toggleFolderCollapse).toBeDefined();
        const t = typeof subject.toggleFolderCollapse;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
