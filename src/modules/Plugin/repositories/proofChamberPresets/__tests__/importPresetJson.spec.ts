import { describe, it, expect } from 'vitest';

import { DEFAULT_PARAMS } from '../../../models/ProofChamberState';
import { importPresetJson } from '../importPresetJson';

describe('importPresetJson', () => {
    it('should merge valid partial params with defaults', () => {
        const raw = JSON.stringify({ mix: 0.9, decay: 0.1 });
        const result = importPresetJson(raw);
        expect(result).not.toBeNull();
        expect(result!.mix).toBe(0.9);
        expect(result!.decay).toBe(0.1);
        expect(result!.space).toBe(DEFAULT_PARAMS.space);
    });

    it('should return null when mix or decay is not numeric', () => {
        expect(importPresetJson(JSON.stringify({ mix: 'bad' }))).toBeNull();
    });

    it('should return null for invalid JSON', () => {
        expect(importPresetJson('{')).toBeNull();
    });
});
