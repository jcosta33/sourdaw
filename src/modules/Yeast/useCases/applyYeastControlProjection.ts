import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';

import { applyYeastRuntimeProjection } from '../engine/yeastRuntime';

import { publishYeastRuntimeStatus } from './publishYeastRuntimeStatus';

import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

export async function applyYeastControlProjection(projection: readonly YeastProcessorProjectionItem[]): Promise<void> {
    const scope = captureAutomergeStorageTransactionScope();
    try {
        await applyYeastRuntimeProjection(projection);
    } finally {
        scope(() => publishYeastRuntimeStatus());
    }
}
