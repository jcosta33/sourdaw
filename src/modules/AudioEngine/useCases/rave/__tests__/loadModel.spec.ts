import { describe, it, expect } from 'vitest';

import * as subject from '../loadModel';

describe('loadModel', () => {
    it('should export loadModel', () => {
        expect(subject.loadModel).toBeDefined();
        const time = typeof subject.loadModel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
