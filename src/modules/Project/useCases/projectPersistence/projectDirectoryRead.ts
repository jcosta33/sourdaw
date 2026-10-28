import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { prepareExternalProjectDocument } from '#/modules/CrdtDocument/useCases';
import { bytesToBase64 } from '#/utils/base64';

import { readProjectDirectory } from '../../repositories/project/projectDirectory';
import { openProjectDirectory, type ProjectDirectoryBinding } from '../../repositories/project/projectDirectoryBinding';

import { collectProjectAllBufferIds, collectProjectOriginalHashes } from './helpers/collectProjectOriginalHashes';
import { isHydratableProjectData } from './helpers/isHydratableProjectData';

export type PreparedProjectDirectoryRead = {
    projectId: string;
    projectName: string;
    createdAt: number;
    decodedAudioBuffers: Record<string, AudioBuffer>;
    frozenAudioBuffers: Record<
        string,
        { sampleRate: number; numberOfChannels: number; channelData: string[]; freezeProjectId: number }
    >;
    media: ReadonlyMap<string, Uint8Array>;
    commitDocument: (shouldContinue: () => boolean) => Promise<boolean>;
};

/** Validate the entire generation and prepare playable buffers before changing the open project. */
export async function prepareProjectDirectoryRead(
    binding: ProjectDirectoryBinding,
    shouldContinue: () => boolean
): Promise<PreparedProjectDirectoryRead> {
    const directory = await openProjectDirectory(binding.root, binding.projectId, false);
    const content = await readProjectDirectory(directory, binding.projectId);
    if (!shouldContinue()) {
        throw new Error('Project directory read was superseded');
    }
    const data: unknown = JSON.parse(content.snapshot);
    if (!isHydratableProjectData(data) || data.meta.projectId !== binding.projectId) {
        throw new Error('Project directory snapshot does not match its document identity');
    }
    const expectedHashes = new Set(collectProjectOriginalHashes(data));
    const manifestHashes = new Set([
        ...content.manifest.media.map((entry) => entry.assetHash),
        ...content.manifest.unavailableOriginals,
    ]);
    if (expectedHashes.size !== manifestHashes.size || [...expectedHashes].some((hash) => !manifestHashes.has(hash))) {
        throw new Error('Project directory media references differ from its document');
    }
    const expectedPcm = new Set(collectProjectAllBufferIds(data));
    if (expectedPcm.size !== content.pcm.size || [...expectedPcm].some((id) => !content.pcm.has(id))) {
        throw new Error('Project directory PCM references differ from its document');
    }
    const audioContext = getAudioContext();
    const decodedAudioBuffers: Record<string, AudioBuffer> = {};
    const frozenAudioBuffers: PreparedProjectDirectoryRead['frozenAudioBuffers'] = {};
    for (const [bufferId, entry] of content.pcm) {
        if (!shouldContinue()) {
            throw new Error('Project directory PCM read was superseded');
        }
        const length = entry.channels[0]?.byteLength / Float32Array.BYTES_PER_ELEMENT;
        if (!length || !Number.isSafeInteger(length)) {
            throw new Error(`Project directory PCM has no samples: ${bufferId}`);
        }
        if (entry.freezeProjectId !== undefined) {
            frozenAudioBuffers[bufferId] = {
                sampleRate: entry.sampleRate,
                numberOfChannels: entry.channels.length,
                channelData: entry.channels.map(bytesToBase64),
                freezeProjectId: entry.freezeProjectId,
            };
            continue;
        }
        const buffer = audioContext.createBuffer(entry.channels.length, length, entry.sampleRate);
        entry.channels.forEach((bytes, channel) => {
            const samples = new Float32Array(bytes.buffer, bytes.byteOffset, length);
            buffer.copyToChannel(samples, channel);
        });
        decodedAudioBuffers[bufferId] = buffer;
    }
    const preparedDocument = await prepareExternalProjectDocument(content.document, binding.projectId);
    if (!shouldContinue()) {
        throw new Error('Project directory document validation was superseded');
    }
    return {
        projectId: binding.projectId,
        projectName: data.meta.name,
        createdAt: data.meta.createdAt,
        decodedAudioBuffers,
        frozenAudioBuffers,
        media: content.media,
        commitDocument: preparedDocument.commit,
    };
}
