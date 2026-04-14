import { describe, it, expect } from 'vitest';
import * as subject from '../GrooveModule';

describe('GrooveModule', () => {
    it('should export GrooveModule', () => {
        expect(subject.GrooveModule).toBeDefined();
        const t = typeof subject.GrooveModule;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
