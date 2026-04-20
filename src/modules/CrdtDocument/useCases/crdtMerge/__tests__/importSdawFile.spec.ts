import { describe, it, expect } from 'vitest';

import * as subject from '../importSdawFile';

describe('importSdawFile', () => {
    it('should export detectImportDecision', () => {
        expect(subject.detectImportDecision).toBeDefined();
        const t = typeof subject.detectImportDecision;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export importSdawFile', () => {
        expect(subject.importSdawFile).toBeDefined();
        const t = typeof subject.importSdawFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
