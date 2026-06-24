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

    it('should drop unknown keys instead of merging them into the result', () => {
        // Regression: arbitrary extra fields must not survive into the params.
        const raw = JSON.stringify({ mix: 0.5, decay: 0.5, bogus: 'evil', __proto__: { polluted: true } });
        const result = importPresetJson(raw);
        expect(result).not.toBeNull();
        expect(result as Record<string, unknown>).not.toHaveProperty('bogus');
        expect(Object.keys(result!).sort()).toEqual(Object.keys(DEFAULT_PARAMS).sort());
    });

    it('should reject an out-of-range numeric field', () => {
        // Regression: a numeric field outside its accepted range is invalid input.
        expect(importPresetJson(JSON.stringify({ mix: 0.5, decay: 0.5, damping: 5 }))).toBeNull();
    });

    it('should reject a non-finite numeric field', () => {
        // JSON cannot carry Infinity, but a stringified null/NaN-shaped value must not slip through.
        expect(importPresetJson(JSON.stringify({ mix: 0.5, decay: 0.5, size: null }))).toBeNull();
    });

    it('should reject an unknown space enum value', () => {
        expect(importPresetJson(JSON.stringify({ mix: 0.5, decay: 0.5, space: 'wormhole' }))).toBeNull();
    });

    it('should reject an unknown algorithm enum value', () => {
        expect(importPresetJson(JSON.stringify({ mix: 0.5, decay: 0.5, algorithm: 'reverb-9000' }))).toBeNull();
    });

    it('should accept and keep valid enum and boolean fields', () => {
        const raw = JSON.stringify({ mix: 0.5, decay: 0.5, space: 'cathedral', algorithm: 'fdn-16', shimmer: true });
        const result = importPresetJson(raw);
        expect(result).not.toBeNull();
        expect(result!.space).toBe('cathedral');
        expect(result!.algorithm).toBe('fdn-16');
        expect(result!.shimmer).toBe(true);
    });

    it('should reject a non-boolean value for a boolean field', () => {
        expect(importPresetJson(JSON.stringify({ mix: 0.5, decay: 0.5, freeze: 'yes' }))).toBeNull();
    });
});
