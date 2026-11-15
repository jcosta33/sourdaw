import {
    DEFAULT_WEBLLM_MODEL_ID,
    type LocalModelTier,
    WEBLLM_MODELS as model_webllm_models,
} from '../../models/ModelInfo';

type ModelInfoProjection = {
    id: string;
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
    memoryGb: number;
    tier: LocalModelTier;
    parameterCount: string;
};

export const WEBLLM_MODELS: ModelInfoProjection[] = model_webllm_models.map((model_info) => ({
    id: model_info.id,
    displayName: model_info.displayName,
    description: model_info.description,
    downloadSize: model_info.downloadSize,
    ramUsage: model_info.ramUsage,
    memoryGb: model_info.memoryGb,
    tier: model_info.tier,
    parameterCount: model_info.parameterCount,
}));

const defaultModel = WEBLLM_MODELS.find((model) => model.id === DEFAULT_WEBLLM_MODEL_ID);
if (defaultModel === undefined) {
    throw new Error(`The default local model ${DEFAULT_WEBLLM_MODEL_ID} is missing from the catalogue.`);
}

export const DEFAULT_WEBLLM_MODEL: ModelInfoProjection = defaultModel;
