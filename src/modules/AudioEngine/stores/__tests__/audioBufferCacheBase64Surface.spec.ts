import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audioBufferCache } from '../audioBufferCache';

import { flushIndexedDbTasks, installFakeAudioIndexedDb } from './fakeAudioBufferIndexedDb';
import { installTestAudioBufferConstructor } from './preparedAudioBufferTestSupport';

/**
 * AC-5 census. Base64 PCM may be produced by exactly one member of the audio
 * buffer cache — the one the explicit, user-initiated `.sourdaw` export runs
 * through — and by no other. Every base64 producer in this module funnels
 * through `btoa`, so counting `btoa` calls detects the encoder wherever it is
 * reached from.
 *
 * The population is `Object.keys(audioBufferCache)` — the same object
 * production imports — not a hand-written list, so a new member that encodes
 * cannot be added without either classifying it here or reding the census.
 */

/** Members allowed to produce base64, with the reason. */
const BASE64_EXEMPT: Record<string, string> = {
    exportBuffers:
        'Explicit user-initiated .sourdaw export only (ADR 0013 decision 2); the export format is deferred to ADR 0014.',
};

function makeAudioBuffer(channelData: Float32Array[], sampleRate = 48_000): AudioBuffer {
    return {
        getChannelData: (channelNumber: number) => channelData[channelNumber]!,
        length: channelData[0]?.length ?? 0,
        numberOfChannels: channelData.length,
        sampleRate,
        duration: (channelData[0]?.length ?? 0) / sampleRate,
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
    } as unknown as AudioBuffer;
}

const PCM = new Float32Array([0.25, -0.5, 0.75]);

function makeContext(): BaseAudioContext {
    return {
        createBuffer: (numberOfChannels: number, length: number, sampleRate: number) =>
            makeAudioBuffer(
                Array.from({ length: numberOfChannels }, () => new Float32Array(length)),
                sampleRate
            ),
    } as unknown as BaseAudioContext;
}

function encodeFloat32(values: Float32Array): string {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function decodeFloat32(encoded: string): Float32Array {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return new Float32Array(bytes.buffer);
}

/** Encoded once, outside the probe, so the fixture's own `btoa` is not counted. */
const ENCODED_PCM = encodeFloat32(PCM);

/**
 * How to drive each non-exempt member so the census actually executes it. A
 * member with no entry here and no exemption fails the coverage assertion —
 * that is what stops the census from going blind.
 */
function buildInvocations(): Record<string, () => unknown> {
    return {
        get: () => audioBufferCache.get('pcm'),
        set: () => audioBufferCache.set('pcm-2', makeAudioBuffer([PCM])),
        remove: () => audioBufferCache.remove('pcm-2'),
        has: () => audioBufferCache.has('pcm'),
        persistPreparedBuffer: () =>
            audioBufferCache.persistPreparedBuffer({
                id: 'prepared-pcm',
                buffer: makeAudioBuffer([PCM]),
                leaseId: 'prepared-lease',
            }),
        reopenPreparedBuffer: () =>
            audioBufferCache.reopenPreparedBuffer({
                id: 'prepared-pcm',
                leaseId: 'prepared-lease',
                context: makeContext(),
            }),
        releasePreparedBuffer: () =>
            audioBufferCache.releasePreparedBuffer({
                id: 'prepared-pcm',
                leaseId: 'prepared-lease',
                disposition: 'discard',
            }),
        getWaveformPeaks: () => audioBufferCache.getWaveformPeaks('pcm', 4),
        restoreFromIdb: () => audioBufferCache.restoreFromIdb({ context: makeContext() }),
        prepareFromIdb: () => audioBufferCache.prepareFromIdb({ context: makeContext() }),
        clear: () => audioBufferCache.clear(),
        cancelPendingImport: () => audioBufferCache.cancelPendingImport(),
        importBuffers: () => {
            const candidate = audioBufferCache.importBuffers({
                context: makeContext(),
                buffers: { imported: { sampleRate: 48_000, numberOfChannels: 1, channelData: [ENCODED_PCM] } },
            });
            candidate?.publish();
            return candidate?.persist();
        },
        garbageCollectFreezeFiles: () =>
            audioBufferCache.garbageCollectFreezeFiles({
                activeIds: new Set(['freeze-project-200-track-keep-1']),
                projectId: 200,
            }),
        garbageCollectByAge: () => audioBufferCache.garbageCollectByAge(30),
        garbageCollectBySize: () => audioBufferCache.garbageCollectBySize(2 ** 31),
    };
}

describe('audioBufferCache base64 surface (AC-5)', () => {
    let realBtoa: typeof btoa;
    let btoaSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        installTestAudioBufferConstructor();
        installFakeAudioIndexedDb();
        realBtoa = globalThis.btoa.bind(globalThis);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function installBtoaCounter(): void {
        btoaSpy = vi.fn((value: string) => realBtoa(value));
        vi.stubGlobal('btoa', btoaSpy);
    }

    it('classifies every member of the cache as base64-exempt or base64-free', () => {
        const invocations = buildInvocations();
        const unclassified = Object.keys(audioBufferCache).filter(
            (member) => !(member in BASE64_EXEMPT) && !(member in invocations)
        );

        expect(unclassified).toEqual([]);
        // Presence pin: the exemption table names a member that really exists,
        // so renaming `exportBuffers` cannot silently empty the exempt set.
        expect(Object.keys(BASE64_EXEMPT).filter((member) => member in audioBufferCache)).toEqual(['exportBuffers']);
    });

    // Mutation: making any covered member encode — e.g. reinstating a
    // `serializeBuffers` that calls `float32ToBase64`, or having `set` embed
    // base64 — reds `expect(encodingMembers).toEqual([])`.
    it('produces no base64 from any member outside the export surface', async () => {
        audioBufferCache.set('pcm', makeAudioBuffer([PCM]));
        await flushIndexedDbTasks(4);

        const invocations = buildInvocations();
        const encodingMembers: string[] = [];
        for (const [member, invoke] of Object.entries(invocations)) {
            installBtoaCounter();
            await invoke();
            await flushIndexedDbTasks(4);
            if (btoaSpy.mock.calls.length > 0) {
                encodingMembers.push(member);
            }
        }

        expect(encodingMembers).toEqual([]);
    });

    // Presence pin for the assertion above (ADR 0015 rule 4): the probe really
    // does see the encoder when the encoder runs, and the export surface really
    // does still produce base64 that decodes back to the exact PCM.
    it('still produces decodable base64 from the export surface, and the probe sees it', async () => {
        audioBufferCache.set('pcm', makeAudioBuffer([PCM]));
        await flushIndexedDbTasks(4);

        installBtoaCounter();
        const exported = await audioBufferCache.exportBuffers(['pcm']);

        expect(btoaSpy.mock.calls.length).toBeGreaterThan(0);
        expect(exported.pcm?.numberOfChannels).toBe(1);
        expect(Array.from(decodeFloat32(exported.pcm!.channelData[0]!))).toEqual([0.25, -0.5, 0.75]);
    });

    it('round-trips explicit freeze ownership while preserving unowned legacy freezes', async () => {
        const ownedId = 'freeze-current-project-1';
        const foreignId = 'freeze-foreign-project-2';
        const legacyId = 'freeze-project-200-legacy-track-2';
        const buffer = makeAudioBuffer([PCM]);
        audioBufferCache.set(ownedId, buffer, { freezeProjectId: 200 });
        audioBufferCache.set(foreignId, buffer, { freezeProjectId: 100 });
        audioBufferCache.set(legacyId, buffer);
        await flushIndexedDbTasks(4);

        const exported = await audioBufferCache.exportBuffers([ownedId, foreignId, legacyId]);

        expect(exported[ownedId]?.freezeProjectId).toBe(200);
        expect(exported[legacyId]?.freezeProjectId).toBeUndefined();

        audioBufferCache.remove(ownedId);
        audioBufferCache.remove(foreignId);
        audioBufferCache.remove(legacyId);
        await flushIndexedDbTasks(4);
        const candidate = audioBufferCache.importBuffers({ buffers: exported, context: makeContext() });
        expect(candidate?.publish()).toBe(3);
        expect((await audioBufferCache.exportBuffers([ownedId]))[ownedId]?.freezeProjectId).toBe(200);
        await expect(candidate?.persist()).resolves.toBe(true);

        await audioBufferCache.garbageCollectFreezeFiles({ activeIds: new Set(), projectId: 200 });

        expect(audioBufferCache.has(ownedId)).toBe(false);
        expect(audioBufferCache.has(foreignId)).toBe(true);
        expect(audioBufferCache.has(legacyId)).toBe(true);
    });
});
