import { describe, it, expect } from 'vitest';

import * as subject from '../unloadModel';

describe('unloadModel', () => {
    it('should export unloadModel', () => {
        expect(subject.unloadModel).toBeDefined();
        const time = typeof subject.unloadModel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
