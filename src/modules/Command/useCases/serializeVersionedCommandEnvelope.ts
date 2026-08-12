import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

export function serializeVersionedCommandEnvelope(envelope: VersionedCommandEnvelope): string {
    return JSON.stringify(envelope);
}
