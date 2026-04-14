import { describe, it, expect } from 'vitest';
import * as subject from '../setProtocol';

describe('setProtocol', () => {
    it('should export setProtocol', () => {
        expect(subject.setProtocol).toBeDefined();
        const t = typeof subject.setProtocol;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
