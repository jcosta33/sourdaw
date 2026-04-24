import { describe, it, expect } from 'vitest';

import * as subject from '../saveProject';

describe('saveProject', () => {
    it('should export saveProject', () => {
        expect(subject.saveProject).toBeDefined();
        const time = typeof subject.saveProject;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
