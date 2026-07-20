import { applyYeastRuntimeProjection } from '../engine/yeastRuntime';

import { publishYeastRuntimeStatus } from './publishYeastRuntimeStatus';

import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

export async function applyYeastControlProjection(projection: readonly YeastProcessorProjectionItem[]): Promise<void> {
    try {
        await applyYeastRuntimeProjection(projection);
    } finally {
        publishYeastRuntimeStatus();
    }
}
