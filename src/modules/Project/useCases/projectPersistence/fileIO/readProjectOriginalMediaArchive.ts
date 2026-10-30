import { base64ToBytes } from '#/utils/base64';

function isArchiveShape(value: unknown): value is { assets: unknown[]; unavailable: unknown[] } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'format' in value &&
        value.format === 'sourdaw-original-media-v1' &&
        'assets' in value &&
        Array.isArray(value.assets) &&
        'unavailable' in value &&
        Array.isArray(value.unavailable)
    );
}

function isMediaEntry(value: unknown): value is { hash: string; bytes: string } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'hash' in value &&
        typeof value.hash === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(value.hash) &&
        'bytes' in value &&
        typeof value.bytes === 'string'
    );
}

export function readProjectOriginalMediaArchive(value: unknown): {
    media: Map<string, Uint8Array>;
    unavailable: string[];
} | null {
    if (typeof value !== 'object' || value === null || !('originalMedia' in value)) {
        return null;
    }
    const archive = value.originalMedia;
    if (!isArchiveShape(archive)) {
        throw new Error('Project original media archive is invalid');
    }
    const media = new Map<string, Uint8Array>();
    for (const entry of archive.assets) {
        if (!isMediaEntry(entry) || media.has(entry.hash)) {
            throw new Error('Project original media archive has an invalid entry');
        }
        media.set(entry.hash, base64ToBytes(entry.bytes));
    }
    const unavailable: string[] = [];
    for (const hash of archive.unavailable) {
        if (
            typeof hash !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/.test(hash) ||
            media.has(hash) ||
            unavailable.includes(hash)
        ) {
            throw new Error('Project original media archive has an invalid unavailable hash');
        }
        unavailable.push(hash);
    }
    return { media, unavailable };
}
