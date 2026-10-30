import { bytesToBase64 } from '#/utils/base64';

import { collectProjectOriginalHashes } from '../helpers/collectProjectOriginalHashes';

import type { ProjectData } from '../../../models/ProjectData';

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
    if (!shouldContinue()) {
        throw new Error('Project changed during original media export');
    }
    return {
        ...data,
        originalMedia: { format: 'sourdaw-original-media-v1', assets, unavailable: originals.unavailable },
    };
}
