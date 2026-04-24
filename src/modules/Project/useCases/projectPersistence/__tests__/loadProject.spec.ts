import { describe, it, expect } from 'vitest';

import * as subject from '../loadProject';

describe('loadProject', () => {
    it('should export loadProject', () => {
        expect(subject.loadProject).toBeDefined();
        const time = typeof subject.loadProject;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
