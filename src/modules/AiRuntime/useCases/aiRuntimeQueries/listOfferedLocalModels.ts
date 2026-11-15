import { offeredLocalModels } from '../../transformers/offeredLocalModels';

import { WEBLLM_MODELS } from './modelInfo';

import type { MachineMemoryReading } from '../../models/MachineMemoryReading';

/** The catalogue models this machine can run, given what is known of its memory. */
export function listOfferedLocalModels(reading: MachineMemoryReading): (typeof WEBLLM_MODELS)[number][] {
    return offeredLocalModels(WEBLLM_MODELS, reading);
}
