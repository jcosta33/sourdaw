import { FNV_1A_OFFSET_BASIS, FNV_1A_PRIME } from '#/utils/canonicalDigest';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
}

function hashContract(value: string): string {
    let hash = FNV_1A_OFFSET_BASIS;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, FNV_1A_PRIME);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getStableContractFingerprint(value: unknown): string {
    return hashContract(JSON.stringify(canonicalize(value)));
}
