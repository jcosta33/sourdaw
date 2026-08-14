import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

function normalizeJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(normalizeJson);
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .toSorted(([left], [right]) => {
                if (left < right) {
                    return -1;
                }
                if (left > right) {
                    return 1;
                }
                return 0;
            })
            .map(([key, nested]) => [key, normalizeJson(nested)])
    );
}

export async function getCommandBatchContentHash(envelope: VersionedCommandBatchEnvelope): Promise<string> {
    const { idempotencyKey: _idempotencyKey, ...content } = envelope;
    const encoded = new TextEncoder().encode(JSON.stringify(normalizeJson(content)));
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
