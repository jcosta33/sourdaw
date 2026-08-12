import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

function normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeJson);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .toSorted(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, normalizeJson(nested)])
    );
}

export function getVersionedCommandSemanticFingerprint(envelope: VersionedCommandEnvelope): string {
    return JSON.stringify(
        normalizeJson({
            schemaVersion: envelope.schemaVersion,
            operation: envelope.operation,
            arguments: envelope.arguments,
            seed: envelope.seed,
            normalizedProjectRevision: envelope.normalizedProjectRevision,
            availableDeviceVersions: envelope.availableDeviceVersions,
        })
    );
}
