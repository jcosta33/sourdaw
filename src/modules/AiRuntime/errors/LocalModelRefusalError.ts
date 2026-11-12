import { type LocalModelRefusal } from '../models/LocalModelRefusal';
import { WEBLLM_MODELS } from '../models/ModelInfo';

/**
 * Decimal gigabytes at the hundredth the model picker states sizes in. The need rounds up and the
 * room left rounds down, so a refusal, which fires only when the room is below the need, never
 * prints the same figure for both.
 */
function formatDecimalGigabytes(bytes: number, rounding: (value: number) => number): string {
    return `${(rounding(bytes / 1e7) / 100).toFixed(2)} GB`;
}

function describeRefusal(refusal: LocalModelRefusal): string {
    const model = WEBLLM_MODELS.find((candidate) => candidate.id === refusal.modelId);
    const name = model?.displayName ?? refusal.modelId;
    if (refusal.reason === 'shader-f16-unavailable') {
        return `The ${name} model cannot run here: this GPU or browser lacks the WebGPU shader-f16 feature it needs. Nothing was downloaded.`;
    }
    if (refusal.reason === 'insufficient-storage') {
        return `The ${name} model needs ${formatDecimalGigabytes(refusal.requiredBytes, Math.ceil)} to download, but this browser has ${formatDecimalGigabytes(refusal.availableBytes, Math.floor)} of storage left. Free some space or pick a smaller model. Nothing was downloaded.`;
    }
    // The figure the model picker shows: the GPU memory the model needs at the window it loads with.
    const need = model === undefined ? '' : `: it needs ${model.ramUsage} of GPU memory`;
    return `The ${name} model did not fit in GPU memory${need}. The download is kept; pick a smaller model or free GPU memory and try again.`;
}

export class LocalModelRefusalError extends Error {
    override readonly name = 'LocalModelRefusalError';
    readonly refusal: LocalModelRefusal;

    constructor(refusal: LocalModelRefusal) {
        super(describeRefusal(refusal));
        this.refusal = refusal;
    }
}

export function isLocalModelRefusalError(error: unknown): error is LocalModelRefusalError {
    return error instanceof Error && error.name === 'LocalModelRefusalError';
}
