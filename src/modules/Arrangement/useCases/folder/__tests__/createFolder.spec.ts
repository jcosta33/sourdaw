import { describe, it, expect } from 'vitest';

import * as subject from '../createFolder';

describe('createFolder', () => {
    it('should export createFolder', () => {
        expect(subject.createFolder).toBeDefined();
        const time = typeof subject.createFolder;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
