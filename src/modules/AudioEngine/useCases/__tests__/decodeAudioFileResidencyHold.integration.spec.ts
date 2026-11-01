import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

import { audioBufferCache } from '../../stores/audioBufferCache';
import { setLiveAudioBufferReferenceReader } from '../../stores/liveAudioBufferReferences';
import { configureDurableAudioBufferOwnership } from '../configureDurableAudioBufferOwnership';
import { decodeAudioFile } from '../decodeAudioFile';
import { openCachedAudioBufferHold } from '../openCachedAudioBufferHold';

const decoding = vi.hoisted(() => ({ decodeAudioFileBuffer: vi.fn<(file: File) => Promise<AudioBuffer>>() }));

vi.mock('../decodeAudioFileBuffer', () => ({ decodeAudioFileBuffer: decoding.decodeAudioFileBuffer }));

/** The runtime cache's LRU cap. */
const CACHE_CAPACITY = 64;
const STEM_COUNT = 4;

class TestAudioBuffer {
    readonly duration: number;
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    private readonly channels: Float32Array<ArrayBuffer>[];

    constructor({ length, numberOfChannels = 1, sampleRate }: AudioBufferOptions) {
        this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
        this.duration = length / sampleRate;
        this.length = length;
        this.numberOfChannels = numberOfChannels;
        this.sampleRate = sampleRate;
    }

    copyFromChannel(destination: Float32Array<ArrayBuffer>, channelNumber: number): void {
        destination.set(this.channels[channelNumber]!.subarray(0, destination.length));
    }

    copyToChannel(source: Float32Array<ArrayBuffer>, channelNumber: number): void {
        this.channels[channelNumber]!.set(source);
    }

    getChannelData(channelNumber: number): Float32Array<ArrayBuffer> {
        return this.channels[channelNumber]!;
    }
}

function createAudioBuffer(): AudioBuffer {
    return new TestAudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: 48_000 });
}

function settleAudioPersistence(): Promise<void> {
    return withProjectAudioStorageLock(() => Promise.resolve());
}

/** Session takes the open arrangement references: none of them may be evicted. */
function fillCacheWithReferencedBuffers(): void {
    const referenced = Array.from({ length: CACHE_CAPACITY }, (_, index) => `referenced-${index}`);
    setLiveAudioBufferReferenceReader(() => referenced);
    for (const id of referenced) {
        audioBufferCache.set(id, createAudioBuffer());
    }
}

async function decodeStems(hold: ReturnType<typeof openCachedAudioBufferHold>): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < STEM_COUNT; index++) {
        const stem = await decodeAudioFile(new File([new Uint8Array(8)], `stem-${index}.wav`), hold);
        ids.push(stem.id);
    }
    return ids;
}

describe('decodeAudioFile residency hold (#6003)', () => {
    let installation: TransactionalIndexedDbInstallation;

    beforeAll(() => {
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        installation = installTransactionalIndexedDb();
    });

    afterAll(async () => {
        await settleAudioPersistence();
        await installation.dispose();
        vi.unstubAllGlobals();
    });

    beforeEach(() => {
        decoding.decodeAudioFileBuffer.mockImplementation(() => Promise.resolve(createAudioBuffer()));
    });

    afterEach(async () => {
        setLiveAudioBufferReferenceReader(null);
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        await settleAudioPersistence();
        audioBufferCache.clear();
        await settleAudioPersistence();
        configureDurableAudioBufferOwnership(null);
    });

    it('keeps every held stem resident until the hold releases, then lets them go', async () => {
        fillCacheWithReferencedBuffers();
        const hold = openCachedAudioBufferHold();
        const stemIds = await decodeStems(hold);

        // Each later stem's write had only the earlier stems to evict.
        expect(stemIds.filter((id) => audioBufferCache.has(id))).toEqual(stemIds);

        // The import never placed them and nothing else references them.
        hold.release();
        audioBufferCache.set('next-import', createAudioBuffer());
        expect(stemIds.filter((id) => audioBufferCache.has(id))).toEqual([]);
    });
});
