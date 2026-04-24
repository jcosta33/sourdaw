import { describe, it, expect } from 'vitest';

import * as subject from '../toggleFolderCollapse';

describe('toggleFolderCollapse', () => {
    it('should export toggleFolderCollapse', () => {
        expect(subject.toggleFolderCollapse).toBeDefined();
        const time = typeof subject.toggleFolderCollapse;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
