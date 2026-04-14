import { describe, it, expect } from 'vitest';
import * as subject from '../toggleInspector';

describe('toggleInspector', () => {
    it('should export toggleInspector', () => {
        expect(subject.toggleInspector).toBeDefined();
        const t = typeof subject.toggleInspector;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
