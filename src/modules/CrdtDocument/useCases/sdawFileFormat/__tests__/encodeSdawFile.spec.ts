import { describe, it, expect } from 'vitest';

import * as subject from '../encodeSdawFile';

describe('encodeSdawFile', () => {
    it('should export encodeSdawFile', () => {
        expect(subject.encodeSdawFile).toBeDefined();
        const time = typeof subject.encodeSdawFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
