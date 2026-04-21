import { describe, it, expect } from 'vitest';

import * as subject from '../exportSdawFile';

describe('exportSdawFile', () => {
    it('should export exportSdawFile', () => {
        expect(subject.exportSdawFile).toBeDefined();
        const time = typeof subject.exportSdawFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
