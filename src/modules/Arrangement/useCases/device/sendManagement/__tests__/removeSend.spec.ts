import { describe, it, expect } from 'vitest';
import * as subject from '../removeSend';

describe('removeSend', () => {
    it('should export removeSend', () => {
        expect(subject.removeSend).toBeDefined();
        const t = typeof subject.removeSend;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
