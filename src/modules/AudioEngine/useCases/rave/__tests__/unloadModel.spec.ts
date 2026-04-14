import { describe, it, expect } from 'vitest';
import * as subject from '../unloadModel';

describe('unloadModel', () => {
    it('should export unloadModel', () => {
        expect(subject.unloadModel).toBeDefined();
        const t = typeof subject.unloadModel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
