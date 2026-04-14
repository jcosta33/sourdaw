import { describe, it, expect } from 'vitest';
import * as subject from '../addUserTag';

describe('addUserTag', () => {
    it('should export addUserTag', () => {
        expect(subject.addUserTag).toBeDefined();
        const t = typeof subject.addUserTag;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
