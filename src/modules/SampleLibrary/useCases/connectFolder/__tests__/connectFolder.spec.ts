import { describe, it, expect } from 'vitest';
import * as subject from '../connectFolder';

describe('connectFolder', () => {
    it('should export connectFolder', () => {
        expect(subject.connectFolder).toBeDefined();
        const t = typeof subject.connectFolder;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
