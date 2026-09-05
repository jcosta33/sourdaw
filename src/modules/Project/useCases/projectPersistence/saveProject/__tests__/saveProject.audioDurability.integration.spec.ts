import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { installMultiDatabaseIndexedDb } from './multiDatabaseIndexedDb';

const CREATED_AT = 1_700_000_000_000;
const PCM = new Float32Array([0, 1, -1, 0]);

function makeMonoWave(samples: Float32Array, sampleRate = 48_000): File {
    const bytesPerSample = Int16Array.BYTES_PER_ELEMENT;
    const bytes = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(bytes);
    const writeAscii = (offset: number, value: string): void => {
        for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, bytes.byteLength - 8, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);
    for (let index = 0; index < samples.length; index++) {
        view.setInt16(44 + index * bytesPerSample, Math.round(samples[index]! * 0x7fff), true);
    }
    const file = new File([bytes], 'durability.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'arrayBuffer', {
        value: () => Promise.resolve(bytes.slice(0)),
    });
    return file;
}

function decodeMonoWave(bytes: ArrayBuffer): AudioBuffer {
    const view = new DataView(bytes);
    const sampleRate = view.getUint32(24, true);
    const sampleCount = view.getUint32(40, true) / Int16Array.BYTES_PER_ELEMENT;
    const channel = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) {
        channel[index] = view.getInt16(44 + index * Int16Array.BYTES_PER_ELEMENT, true) / 0x7fff;
    }
    return {
        duration: sampleCount / sampleRate,
        getChannelData: () => channel,
        length: sampleCount,
        numberOfChannels: 1,
        sampleRate,
    } as AudioBuffer;
}

function createAudioBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
        duration: length / sampleRate,
        getChannelData: (channel: number) => channels[channel]!,
        length,
        numberOfChannels,
        sampleRate,
    } as AudioBuffer;
}

describe('saveProject audio durability integration', () => {
    beforeEach(() => {
        localStorage.clear();
        injectDependencies(notifyUser, { eventBus: { emit: vi.fn(() => Promise.resolve()) } });
    });

    afterEach(async () => {
        const { stopActiveAutoSave } = await import('../../helpers/stopActiveAutoSave');
        stopActiveAutoSave();
        vi.unstubAllGlobals();
    });

    it('refuses an audio-only aborted save and keeps the imported PCM recoverable in the working project', async () => {
        const indexedDb = installMultiDatabaseIndexedDb();
        const [
            { audioEngine, clearRuntimeCachedAudioBuffers, getCachedAudioBuffer, restoreCachedAudioBuffersFromIdb },
            { importAudioFile },
            project,
            { projectStore },
            { trackStore },
            { resetCrdtProjectAuthority },
            { resetModuleStoresToDefault },
            { createFreshProjectMetadata },
            { configureCollaborationAssetOwner },
        ] = await Promise.all([
            import('#/modules/AudioEngine/useCases'),
            import('#/modules/Arrangement/useCases'),
            import('#/modules/Project/useCases'),
            import('#/modules/Project/stores'),
            import('#/modules/Arrangement/stores'),
            import('#/modules/CrdtDocument/useCases'),
            import('../../helpers/resetModuleStoresToDefault'),
            import('../../../createFreshProjectMetadata'),
            import('#/modules/Collaboration/useCases'),
        ]);
        const context = audioEngine.context as AudioContext & {
            createBuffer: typeof createAudioBuffer;
            decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
        };
        context.createBuffer = createAudioBuffer;
        context.decodeAudioData = (bytes) => Promise.resolve(decodeMonoWave(bytes));
        await restoreCachedAudioBuffersFromIdb({ audioContext: context });

        configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
        resetCrdtProjectAuthority('Durability');
        resetModuleStoresToDefault();
        projectStore.set({
            ...createFreshProjectMetadata({
                name: 'Durability',
                loading: false,
                initialized: true,
            }),
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            dirty: true,
        });

        indexedDb.pauseAudioWriteSettlements();
        await importAudioFile(makeMonoWave(PCM));

        const importedClip = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        expect(importedClip).toBeDefined();
        await vi.waitFor(() => expect(indexedDb.pendingAudioWriteSettlements()).toBe(1));
        indexedDb.abortAudioWrites();
        indexedDb.releaseNextAudioWriteSettlement();
        await vi.waitFor(() => expect(indexedDb.rejectedAudioWriteCount()).toBe(1));
        indexedDb.resumeAudioWriteSettlements();

        const bufferId = importedClip?.audioBufferId;
        if (!bufferId) {
            throw new Error('expected the real import path to publish an audio clip');
        }
        const saved = await project.saveProject();
        const dirtyAfterSave = projectStore.value?.dirty;
        const workingSamples = getCachedAudioBuffer({ bufferId })?.getChannelData(0);

        expect(indexedDb.get('sourdaw-audio', 'buffers', bufferId)).toBeUndefined();
        expect(saved).toBe(false);
        expect(dirtyAfterSave).toBe(true);
        expect(workingSamples).toEqual(PCM);

        indexedDb.allowAudioWrites();
        expect(await project.saveProject()).toBe(true);
        expect(projectStore.value?.dirty).toBe(false);
        expect(indexedDb.get('sourdaw-audio', 'buffers', bufferId)).toBeDefined();

        clearRuntimeCachedAudioBuffers();
        await restoreCachedAudioBuffersFromIdb({ audioContext: context, bufferIds: [bufferId] });
        expect(getCachedAudioBuffer({ bufferId })?.getChannelData(0)).toEqual(PCM);
    }, 20_000);
});
