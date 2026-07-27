import { describe, expect, it } from 'vitest';

import {
    NATIVE_MODEL_INFO as model_native_model_info,
    WEBLLM_MODELS as model_webllm_models,
} from '../../../models/ModelInfo';
import { NATIVE_MODEL_INFO, WEBLLM_MODELS } from '../modelInfo';

describe('modelInfo', () => {
    it('should expose copied WebLLM model projections with every runtime field', () => {
        expect(WEBLLM_MODELS).toEqual(model_webllm_models);
        expect(WEBLLM_MODELS).not.toBe(model_webllm_models);

        for (const [index, model_info] of WEBLLM_MODELS.entries()) {
            expect(model_info).not.toBe(model_webllm_models[index]);
        }
    });

    it('should expose a copied native model projection with every runtime field', () => {
        expect(NATIVE_MODEL_INFO).toEqual(model_native_model_info);
        expect(NATIVE_MODEL_INFO).not.toBe(model_native_model_info);
    });
});
