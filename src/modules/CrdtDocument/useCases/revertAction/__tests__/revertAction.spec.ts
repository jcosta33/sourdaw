import { describe, it, expect } from 'vitest';
import * as subject from '../revertAction';

describe('revertAction', () => {
    it('should export revertAction', () => {
        expect(subject.revertAction).toBeDefined();
        const t = typeof subject.revertAction;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
