import { describe, it, expect } from 'vitest';

import * as subject from '../createFromTemplate';

describe('createFromTemplate', () => {
    it('should export createFromTemplate', () => {
        expect(subject.createFromTemplate).toBeDefined();
        const time = typeof subject.createFromTemplate;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
