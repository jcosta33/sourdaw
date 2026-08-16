import { WEBLLM_MODELS as model_webllm_models } from '../../models/ModelInfo';

type ModelInfoProjection = {
    id: string;
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
    parameterCount: string;
};

export const WEBLLM_MODELS: ModelInfoProjection[] = model_webllm_models.map((model_info) => ({
    id: model_info.id,
    displayName: model_info.displayName,
    description: model_info.description,
    downloadSize: model_info.downloadSize,
    ramUsage: model_info.ramUsage,
    parameterCount: model_info.parameterCount,
}));
