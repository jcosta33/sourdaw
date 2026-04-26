import { describe, it, expect } from 'vitest';

import * as subject from '../renameProject';

describe('renameProject', () => {
    it('should export renameProject', () => {
        expect(subject.renameProject).toBeDefined();
        const time = typeof subject.renameProject;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
