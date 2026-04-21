import { describe, it, expect } from 'vitest';

import * as subject from '../decodeSdawFile';

describe('decodeSdawFile', () => {
    it('should export decodeSdawFile', () => {
        expect(subject.decodeSdawFile).toBeDefined();
        const time = typeof subject.decodeSdawFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
