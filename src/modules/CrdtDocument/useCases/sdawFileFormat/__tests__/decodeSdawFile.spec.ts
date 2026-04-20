import { describe, it, expect } from 'vitest';

import * as subject from '../decodeSdawFile';

describe('decodeSdawFile', () => {
    it('should export decodeSdawFile', () => {
        expect(subject.decodeSdawFile).toBeDefined();
        const t = typeof subject.decodeSdawFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
