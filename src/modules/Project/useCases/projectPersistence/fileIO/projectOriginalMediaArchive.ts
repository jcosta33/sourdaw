import { base64ToBytes, bytesToBase64 } from '#/utils/base64';

import type { ProjectData } from '../../../models/ProjectData';
import { collectProjectOriginalHashes } from '../helpers/collectProjectOriginalHashes';

type ProjectOriginalMediaArchive = {
    format: 'sourdaw-original-media-v1';
    assets: Array<{ hash: string; bytes: string }>;
    unavailable: string[];
};

export type ProjectDataWithOriginalMedia = ProjectData & { originalMedia: ProjectOriginalMediaArchive };

export async function buildProjectOriginalMediaArchive(
    data: ProjectData,
    shouldContinue: () => boolean
): Promise<ProjectDataWithOriginalMedia> {
    const projectId = data.meta.projectId;
    if (!projectId) {
        throw new Error('Project export has no stable project identity');
    }
    const hashes = collectProjectOriginalHashes(data);
    if (hashes.length === 0) {
        return { ...data, originalMedia: { format: 'sourdaw-original-media-v1', assets: [], unavailable: [] } };
    }
    const { captureProjectOriginalMedia } = await import('#/modules/Collaboration/useCases');
    const originals = await captureProjectOriginalMedia(projectId, hashes, shouldContinue);
    const assets: ProjectOriginalMediaArchive['assets'] = [];
    for (const [hash, blob] of originals.media) {
        if (!shouldContinue()) {
            throw new Error('Project changed during original media export');
        }
        assets.push({ hash, bytes: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
    return {
        ...data,
        originalMedia: { format: 'sourdaw-original-media-v1', assets, unavailable: originals.unavailable },
    };
}

export function readProjectOriginalMediaArchive(value: unknown): {
    media: Map<string, Uint8Array>;
    unavailable: string[];
} | null {
    if (typeof value !== 'object' || value === null || !('originalMedia' in value)) {
        return null;
    }
    const archive = value.originalMedia;
    if (
        typeof archive !== 'object' ||
        archive === null ||
        !('format' in archive) ||
        archive.format !== 'sourdaw-original-media-v1' ||
        !('assets' in archive) ||
        !Array.isArray(archive.assets) ||
        !('unavailable' in archive) ||
        !Array.isArray(archive.unavailable)
    ) {
        throw new Error('Project original media archive is invalid');
    }
    const media = new Map<string, Uint8Array>();
    for (const value of archive.assets) {
        if (
            typeof value !== 'object' ||
            value === null ||
            !('hash' in value) ||
            typeof value.hash !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/.test(value.hash) ||
            !('bytes' in value) ||
            typeof value.bytes !== 'string' ||
            media.has(value.hash)
        ) {
            throw new Error('Project original media archive has an invalid entry');
        }
        media.set(value.hash, base64ToBytes(value.bytes));
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
