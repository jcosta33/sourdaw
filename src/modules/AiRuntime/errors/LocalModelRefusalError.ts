import { type LocalModelRefusal } from '../models/LocalModelRefusal';
import { WEBLLM_MODELS } from '../models/ModelInfo';

const BYTES_PER_MIB = 1024 * 1024;

/** Decimal gigabytes, the unit a model's download size is stated in, rounded up to a tenth. */
function formatDecimalGigabytes(bytes: number): string {
    return `${(Math.ceil(bytes / 1e8) / 10).toFixed(1)} GB`;
}

function describeRefusal(refusal: LocalModelRefusal): string {
    const name = WEBLLM_MODELS.find((model) => model.id === refusal.modelId)?.displayName ?? refusal.modelId;
    if (refusal.reason === 'shader-f16-unavailable') {
        return `The ${name} model cannot run here: this GPU or browser lacks the WebGPU shader-f16 feature it needs. Nothing was downloaded.`;
    }
    if (refusal.reason === 'insufficient-storage') {
        return `The ${name} model needs ${formatDecimalGigabytes(refusal.requiredBytes)} to download, but this browser has ${formatDecimalGigabytes(refusal.availableBytes)} of storage left. Free some space or pick a smaller model. Nothing was downloaded.`;
    }
    return `The ${name} model did not fit in GPU memory: it needs at least ${formatDecimalGigabytes(refusal.requiredGpuMemoryMb * BYTES_PER_MIB)}. The download is kept; pick a smaller model or free GPU memory and try again.`;
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
