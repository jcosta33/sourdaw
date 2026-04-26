import { describe, it, expect } from 'vitest';

import * as subject from '../createProjectVersion';

describe('createProjectVersion', () => {
    it('should export createProjectVersion', () => {
        expect(subject.createProjectVersion).toBeDefined();
        const time = typeof subject.createProjectVersion;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
