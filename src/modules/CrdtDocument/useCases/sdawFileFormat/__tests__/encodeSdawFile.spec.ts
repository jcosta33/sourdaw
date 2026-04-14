import { describe, it, expect } from 'vitest';
import * as subject from '../encodeSdawFile';

describe('encodeSdawFile', () => {
    it('should export encodeSdawFile', () => {
        expect(subject.encodeSdawFile).toBeDefined();
        const t = typeof subject.encodeSdawFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
