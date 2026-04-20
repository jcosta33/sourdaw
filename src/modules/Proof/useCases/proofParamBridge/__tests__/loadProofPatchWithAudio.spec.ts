import { describe, it, expect } from 'vitest';

import * as subject from '../loadProofPatchWithAudio';

describe('loadProofPatchWithAudio', () => {
    it('should export loadProofPatchWithAudio', () => {
        expect(subject.loadProofPatchWithAudio).toBeDefined();
        const t = typeof subject.loadProofPatchWithAudio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export syncDynBands', () => {
        expect(subject.syncDynBands).toBeDefined();
        const t = typeof subject.syncDynBands;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export syncEqBands', () => {
        expect(subject.syncEqBands).toBeDefined();
        const t = typeof subject.syncEqBands;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export syncExciter', () => {
        expect(subject.syncExciter).toBeDefined();
        const t = typeof subject.syncExciter;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export syncFullPatch', () => {
        expect(subject.syncFullPatch).toBeDefined();
        const t = typeof subject.syncFullPatch;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export syncImager', () => {
        expect(subject.syncImager).toBeDefined();
        const t = typeof subject.syncImager;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
