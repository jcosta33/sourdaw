import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

export function serializeVersionedCommandBatchEnvelope(envelope: VersionedCommandBatchEnvelope): string {
    return JSON.stringify(envelope);
}
