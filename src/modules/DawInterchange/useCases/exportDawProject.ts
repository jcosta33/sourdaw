import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { audioBufferToWav } from '#/modules/AudioRendering/useCases';
import { buildProjectData } from '#/modules/Project/useCases';

import { buildDawProjectZip } from './buildDawProjectZip';
import { type ProjectData } from './projectDataContract';
import { serializeMetadataXml } from './serializeMetadataXml';
import { serializeProjectXml } from './serializeProjectXml';

export type ExportDawProjectOutput = Promise<{
    bytes: Uint8Array;
    fileName: string;
    /**
     * Clips whose audio could not be bundled because the buffer was not in the
     * cache. They serialize as a `<Clip/>` with no `<Audio>` child, so the
     * destination DAW plays silence there — the caller has to say so (audit
     * M-263). `buildProjectData` cannot supply this: its own
     * `missingBufferCount` is short-circuited to 0 under
     * `includeAudioBuffers: false`, which is how this path calls it.
     */
    missingAudioCount: number;
}>;

function collectAudioBufferIds(project: ProjectData): string[] {
    const ids = new Set<string>();
    for (const track of project.arrangement.tracks) {
        for (const clip of track.clips) {
            if (clip.bufferId) {
                ids.add(clip.bufferId);
            }
        }
    }
    return [...ids];
}

function sanitizeForPath(value: string): string {
    return value.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

export async function exportDawProject(): ExportDawProjectOutput {
    const built = await buildProjectData({ includeAudioBuffers: false });
    if (!built) {
        throw new Error('Cannot export DAWproject: project state is not fully loaded.');
    }
    const projectData = built.data;

    const bufferIds = collectAudioBufferIds(projectData);
    const audioPathByBufferId = new Map<string, string>();
    const audioFiles = new Map<string, Uint8Array>();

    let missingAudioCount = 0;

    for (const id of bufferIds) {
        const buffer = getCachedAudioBuffer({ bufferId: id });
        if (!buffer) {
            missingAudioCount++;
            continue;
        }
        const fileName = `${sanitizeForPath(id)}.wav`;
        const relativePath = `audio/${fileName}`;
        const wav = await audioBufferToWav(buffer, 24);
        audioFiles.set(relativePath, new Uint8Array(wav));
        audioPathByBufferId.set(id, relativePath);
    }

    const projectXml = serializeProjectXml({
        project: projectData,
        audioPathByBufferId,
    });

    const metadataXml = serializeMetadataXml({
        title: projectData.meta.name,
        artist: '',
        comment: '',
    });

    const bytes = buildDawProjectZip({
        projectXml,
        metadataXml,
        audioFiles,
    });

    const fileName = `${sanitizeForPath(projectData.meta.name || 'Sourdaw_Export')}.dawproject`;
    return { bytes, fileName, missingAudioCount };
}
