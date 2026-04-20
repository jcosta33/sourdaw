import { describe, it, expect } from 'vitest';

import * as subject from '../loadModel';

describe('loadModel', () => {
    it('should export loadModel', () => {
        expect(subject.loadModel).toBeDefined();
        const t = typeof subject.loadModel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
