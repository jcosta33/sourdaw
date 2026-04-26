import { describe, it, expect } from 'vitest';

import * as subject from '../exportProjectFile';

describe('exportProjectFile', () => {
    it('should export exportProjectFile', () => {
        expect(subject.exportProjectFile).toBeDefined();
        const time = typeof subject.exportProjectFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
