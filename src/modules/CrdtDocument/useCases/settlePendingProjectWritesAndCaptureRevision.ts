import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { captureProjectRevision } from './captureProjectRevision';

/**
 * Establish a new planning base from durable project truth.
 *
 * Local stores expose writes before their animation-frame CRDT flush. Settling
 * those writes first prevents their later in-app flush from looking like
 * concurrent divergence from a revision captured against the same visible
 * project state.
 */
export function settlePendingProjectWritesAndCaptureRevision(): string {
    flushAutomergeStorageWrites();
    return captureProjectRevision();
}
