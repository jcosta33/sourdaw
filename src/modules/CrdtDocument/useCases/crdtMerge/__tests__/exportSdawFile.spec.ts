import { describe, it, expect } from 'vitest';

import * as subject from '../exportSdawFile';

describe('exportSdawFile', () => {
    it('should export exportSdawFile', () => {
        expect(subject.exportSdawFile).toBeDefined();
        const t = typeof subject.exportSdawFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
