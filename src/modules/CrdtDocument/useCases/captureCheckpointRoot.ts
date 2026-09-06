import { automergeRepository } from '../repositories/automergeRepository';

import { settlePendingProjectWritesAndCaptureRevision } from './settlePendingProjectWritesAndCaptureRevision';

export async function captureCheckpointRoot(): Promise<{ rootBytes: Uint8Array; projectRevision: string }> {
    const projectRevision = settlePendingProjectWritesAndCaptureRevision();
    const rootId = automergeRepository.getRootId();
    const bundle = await automergeRepository.saveAllOffThread();
    const rootBytes = bundle.get(rootId);

    if (!rootBytes) {
        throw new Error('[captureCheckpointRoot] Checkpoint root document is missing');
    }

    const settledRevision = settlePendingProjectWritesAndCaptureRevision();
    if (settledRevision !== projectRevision) {
        throw new Error('[captureCheckpointRoot] Project changed during checkpoint capture');
    }

    return { rootBytes, projectRevision };
}
