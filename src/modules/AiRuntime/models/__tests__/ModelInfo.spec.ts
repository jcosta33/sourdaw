import { describe, expect, it } from 'vitest';

import { DEFAULT_WEBLLM_MODEL_ID, NATIVE_MODEL_INFO, WEBLLM_MODELS } from '../ModelInfo';

describe('WEBLLM_MODELS', () => {
    it('contains exactly 3 browser models', () => {
        expect(WEBLLM_MODELS).toHaveLength(3);
    });

    it('every model has a unique id', () => {
        const ids = WEBLLM_MODELS.map((m) => m.id);
        expect(new Set(ids).size).toBe(3);
    });

    it('every model has non-empty required fields', () => {
        for (const model of WEBLLM_MODELS) {
            expect(model.id.length).toBeGreaterThan(0);
            expect(model.displayName.length).toBeGreaterThan(0);
            expect(model.description.length).toBeGreaterThan(0);
            expect(model.downloadSize.length).toBeGreaterThan(0);
            expect(model.ramUsage.length).toBeGreaterThan(0);
            expect(model.parameterCount.length).toBeGreaterThan(0);
        }
    });

    it('includes Light, Standard, and Pro tiers', () => {
        const names = WEBLLM_MODELS.map((m) => m.displayName);
        expect(names).toContain('Light');
        expect(names).toContain('Standard');
        expect(names).toContain('Pro');
    });
});

describe('DEFAULT_WEBLLM_MODEL_ID', () => {
    it('points to the Standard model', () => {
        expect(DEFAULT_WEBLLM_MODEL_ID).toBe('Qwen3-4B-q4f16_1-MLC');
    });

    it('matches an existing model id in WEBLLM_MODELS', () => {
        const ids = WEBLLM_MODELS.map((m) => m.id);
        expect(ids).toContain(DEFAULT_WEBLLM_MODEL_ID);
    });
});

describe('NATIVE_MODEL_INFO', () => {
    it('has a huggingFaceId', () => {
        expect(NATIVE_MODEL_INFO.huggingFaceId).toBe('Qwen/Qwen3-8B');
    });

    it('has 8B parameter count', () => {
        expect(NATIVE_MODEL_INFO.parameterCount).toBe('8B');
    });

    it('has all required ModelInfo fields', () => {
        expect(NATIVE_MODEL_INFO.id.length).toBeGreaterThan(0);
        expect(NATIVE_MODEL_INFO.displayName.length).toBeGreaterThan(0);
        expect(NATIVE_MODEL_INFO.description.length).toBeGreaterThan(0);
        expect(NATIVE_MODEL_INFO.downloadSize.length).toBeGreaterThan(0);
        expect(NATIVE_MODEL_INFO.ramUsage.length).toBeGreaterThan(0);
    });
});
