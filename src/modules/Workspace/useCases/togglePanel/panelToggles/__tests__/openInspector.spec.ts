import { describe, it, expect } from 'vitest';
import * as subject from '../openInspector';

describe('openInspector', () => {
    it('should export openInspector', () => {
        expect(subject.openInspector).toBeDefined();
        const t = typeof subject.openInspector;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
