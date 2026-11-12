/**
 * Why a machine cannot run a local model, decided before or at load. A refusal never deletes a
 * download and leaves the engine free to load another model.
 */
export type LocalModelRefusal =
    | { reason: 'shader-f16-unavailable'; modelId: string }
    | { reason: 'insufficient-storage'; modelId: string; requiredBytes: number; availableBytes: number }
    | { reason: 'gpu-memory'; modelId: string };
