import {
    NATIVE_MODEL_INFO as model_native_model_info,
    WEBLLM_MODELS as model_webllm_models,
} from '../../models/ModelInfo';

type ModelInfoProjection = {
    id: string;
    displayName: string;
    description: string;
    downloadSize: string;
    ramUsage: string;
    parameterCount: string;
};

type NativeModelInfoProjection = ModelInfoProjection & {
    huggingFaceId: string;
};

export const WEBLLM_MODELS: ModelInfoProjection[] = model_webllm_models.map((model_info) => ({
    id: model_info.id,
    displayName: model_info.displayName,
    description: model_info.description,
    downloadSize: model_info.downloadSize,
    ramUsage: model_info.ramUsage,
    parameterCount: model_info.parameterCount,
}));

export const NATIVE_MODEL_INFO: NativeModelInfoProjection = {
    id: model_native_model_info.id,
    displayName: model_native_model_info.displayName,
    description: model_native_model_info.description,
    downloadSize: model_native_model_info.downloadSize,
    ramUsage: model_native_model_info.ramUsage,
    parameterCount: model_native_model_info.parameterCount,
    huggingFaceId: model_native_model_info.huggingFaceId,
};
