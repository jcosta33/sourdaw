import { describe, it, expect } from 'vitest';

import * as subject from '../importSdawFile';

describe('importSdawFile', () => {
    it('should export detectImportDecision', () => {
        expect(subject.detectImportDecision).toBeDefined();
        const time = typeof subject.detectImportDecision;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export importSdawFile', () => {
        expect(subject.importSdawFile).toBeDefined();
        const time = typeof subject.importSdawFile;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
