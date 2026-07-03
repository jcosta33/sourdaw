import { describe, it, expect } from 'vitest';

import { detectImportDecision } from '../detectImportDecision';
import { importSdawFile } from '../importSdawFile';

describe('importSdawFile', () => {
    it('should export detectImportDecision', () => {
        expect(detectImportDecision).toBeDefined();
        const time = typeof detectImportDecision;
        expect(time).toBe('function');
    });
    it('should export importSdawFile', () => {
        expect(importSdawFile).toBeDefined();
        const time = typeof importSdawFile;
        expect(time).toBe('function');
    });
});
