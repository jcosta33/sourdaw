import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { prepareExternalProjectDocument } from '#/modules/CrdtDocument/useCases';
import { bytesToBase64 } from '#/utils/base64';

import { projectDirectory } from '../../repositories/project/projectDirectory';
import {
    projectDirectoryBinding,
    type ProjectDirectoryBinding,
} from '../../repositories/project/projectDirectoryBinding';

import { collectProjectAllBufferIds } from './helpers/collectProjectAllBufferIds';
import { collectProjectOriginalHashes } from './helpers/collectProjectOriginalHashes';
import { isHydratableProjectData } from './helpers/isHydratableProjectData';

const { openProjectDirectory } = projectDirectoryBinding;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectTrackMediaBindings(
    bindings: Map<string, string>,
    tracks: unknown,
    scope: string,
    bufferField: 'audioBufferId' | 'bufferId'
): void {
    if (!Array.isArray(tracks)) {
        return;
    }
    for (const [trackIndex, track] of tracks.entries()) {
        if (!isRecord(track)) {
            continue;
        }
        const trackId = typeof track.id === 'string' ? track.id : trackIndex;
        const freeze = isRecord(track.freezeState) ? track.freezeState : null;
        const frozenId = freeze?.frozenBufferId ?? track.frozenBufferId;
        if (typeof frozenId === 'string') {
            bindings.set(JSON.stringify([scope, trackIndex, trackId, 'freeze']), frozenId);
        }
        const addClips = (clips: unknown, alternativeId: string, alternativeIndex: number): void => {
            if (!Array.isArray(clips)) {
                return;
            }
            for (const [clipIndex, clip] of clips.entries()) {
                if (!isRecord(clip)) {
                    continue;
                }
                const bufferId = clip[bufferField];
                const hash = clip.assetHash;
                if (typeof bufferId !== 'string' && typeof hash !== 'string') {
                    continue;
                }
                const clipId = typeof clip.id === 'string' ? clip.id : clipIndex;
                bindings.set(
                    JSON.stringify([scope, trackIndex, trackId, alternativeIndex, alternativeId, clipIndex, clipId]),
                    JSON.stringify([
                        typeof bufferId === 'string' ? bufferId : null,
                        typeof hash === 'string' ? hash : null,
                    ])
                );
            }
        };
        addClips(track.clips, 'active', -1);
        if (Array.isArray(track.alternatives)) {
            for (const [alternativeIndex, alternative] of track.alternatives.entries()) {
                if (isRecord(alternative)) {
                    const alternativeId = typeof alternative.id === 'string' ? alternative.id : alternativeIndex;
                    addClips(alternative.clips, String(alternativeId), alternativeIndex);
                }
            }
        }
    }
}

function collectDirectoryMediaBindings(
    tracks: unknown,
    arrangements: unknown,
    bufferField: 'audioBufferId' | 'bufferId'
): Map<string, string> {
    const bindings = new Map<string, string>();
    collectTrackMediaBindings(bindings, tracks, 'active', bufferField);
    if (Array.isArray(arrangements)) {
        for (const [index, arrangement] of arrangements.entries()) {
            if (!isRecord(arrangement)) {
                continue;
            }
            const id = typeof arrangement.id === 'string' ? arrangement.id : index;
            const trackState = isRecord(arrangement.tracks) ? arrangement.tracks : null;
            collectTrackMediaBindings(
                bindings,
                trackState?.tracks,
                JSON.stringify(['arrangement', index, id]),
                bufferField
            );
        }
    }
    return bindings;
}

function sameMediaBindings(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
    if (left.size !== right.size) {
        return false;
    }
    for (const [key, value] of left) {
        if (right.get(key) !== value) {
            return false;
        }
    }
    return true;
}

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
    const content = await projectDirectory.read(directory, binding.projectId);
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
        const firstChannel = entry.channels[0];
        const length = firstChannel ? firstChannel.byteLength / Float32Array.BYTES_PER_ELEMENT : 0;
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
        for (const [channel, bytes] of entry.channels.entries()) {
            const samples = new Float32Array(length);
            samples.set(new Float32Array(bytes.buffer, bytes.byteOffset, length));
            buffer.copyToChannel(samples, channel);
        }
        decodedAudioBuffers[bufferId] = buffer;
    }
    const preparedDocument = await prepareExternalProjectDocument(content.document, binding.projectId);
    if (!shouldContinue()) {
        throw new Error('Project directory document validation was superseded');
    }
    const documentArrangements = isRecord(preparedDocument.rootMediaSlots.arrangements)
        ? preparedDocument.rootMediaSlots.arrangements.arrangements
        : null;
    const documentTracks = isRecord(preparedDocument.rootMediaSlots.tracks)
        ? preparedDocument.rootMediaSlots.tracks.tracks
        : null;
    const documentBindings = collectDirectoryMediaBindings(documentTracks, documentArrangements, 'audioBufferId');
    const snapshotBindings = collectDirectoryMediaBindings(data.arrangement.tracks, data.arrangements, 'bufferId');
    // A matching set of files cannot prove that each clip or freeze owns the same media.
    if (!sameMediaBindings(documentBindings, snapshotBindings)) {
        throw new Error('Project directory media references differ between its document and snapshot');
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
