import { describe, it, expect } from 'vitest';

import * as subject from '../initWAMEnvironment';

describe('initWAMEnvironment', () => {
    it('should export initWAMEnvironment', () => {
        expect(subject.initWAMEnvironment).toBeDefined();
        const time = typeof subject.initWAMEnvironment;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
