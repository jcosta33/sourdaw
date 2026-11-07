import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { isDesktopRuntime } from '#/utils/desktopBridge';

const SAMPLE_RATE = 44_100;
const SOURCE_HZ = 220;
const TRACK_ID = 'knead-source-track';
const CLIP_ID = 'knead-source-clip';
const SOURCE_BUFFER_ID = 'knead-source-pcm';
const SOURCE_FILE = 'source.wav';

async function importRuntime() {
    // Enter one composition graph first: concurrent imports of these barrels
    // can deadlock the Vitest module runner before a case starts.
    await import('#/app/registerProjectLifecycle');
    const projections = await import('#/app/registerProjectSlotProjections');
    const arrangement = await import('#/modules/Arrangement/useCases');
    const arrangementStores = await import('#/modules/Arrangement/stores');
    const command = await import('#/modules/Command/useCases');
    const commandStores = await import('#/modules/Command/stores');
    const crdt = await import('#/modules/CrdtDocument/useCases');
    const knead = await import('#/modules/Knead/useCases');
    const kneadStores = await import('#/modules/Knead/stores');
    const transport = await import('#/modules/Transport/useCases');
    const audio = await import('../../index');
    const cache = await import('../../../stores/audioBufferCache');
    const pitch = await import('../commitPitchEdit');
    const dsp = await import('../../../wasm/daw_dsp.js');
    return {
        projections,
        arrangement,
        arrangementStores,
        command,
        commandStores,
        crdt,
        knead,
        kneadStores,
        transport,
        audio,
        cache,
        pitch,
        dsp,
    };
}

let runtime: Awaited<ReturnType<typeof importRuntime>>;
let database: ReturnType<typeof installTransactionalIndexedDb> | undefined;
let unsubscribeHistory: (() => void) | undefined;
let setupComplete = false;
const publishedBufferIds = new Set<string>();

async function settlePublishedPcm(ids: readonly string[]): Promise<void> {
    const receipt = await runtime.audio.ensureCachedAudioBuffersDurable(ids);
    if (receipt.status !== 'durable') {
        throw new Error(`Actual PCM durability did not settle: ${JSON.stringify(receipt)}`);
    }
    try {
        expect(receipt.isCurrent()).toBe(true);
    } finally {
        receipt.release();
    }
}

type ClipObservation = {
    id: string;
    fileId?: string;
    audioBufferId?: string;
    kneadState?: { blobs: unknown[] };
};

function projectedClip(): ClipObservation {
    const clip = runtime.arrangementStores.trackStore.value?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.clips.find((candidate) => candidate.id === CLIP_ID);
    if (!clip) {
        throw new Error('Typed addClip did not publish the source clip');
    }
    return clip;
}

function rawClip(): ClipObservation {
    const root = runtime.crdt.getCrdtDoc<{ tracks?: { tracks: Array<{ id: string; clips: ClipObservation[] }> } }>(
        'root'
    );
    const clip = root?.tracks?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.clips.find((candidate) => candidate.id === CLIP_ID);
    if (!clip) {
        throw new Error('The source clip is absent from raw project truth');
    }
    return clip;
}

function historyDepth(): number {
    return runtime.commandStores.undoStore.value?.past.length ?? 0;
}

function durableHistoryDepth(): number {
    return (
        runtime.crdt.getCrdtDoc<{ actionHistory?: { entries: unknown[] } }>('root')?.actionHistory?.entries.length ?? 0
    );
}

/** PSOLA needs epochs: the real Rust commit oracle uses eight harmonics,
 * because a pure sine is pathological input for this pitch-shift algorithm. */
function sourceChannels(): Float32Array<ArrayBuffer>[] {
    return [0, 1].map((channel) =>
        Float32Array.from({ length: SAMPLE_RATE }, (_, frame) => {
            let value = 0;
            for (let harmonic = 1; harmonic <= 8; harmonic++) {
                const phase = (2 * Math.PI * SOURCE_HZ * harmonic * frame) / SAMPLE_RATE;
                const weight = channel === 0 ? 1 : harmonic % 2 === 0 ? 0.35 : 0.7;
                value += (Math.sin(phase + channel * harmonic * 0.31) * weight) / harmonic;
            }
            return value * 0.2;
        })
    );
}

/** Independent sample-domain oracle from pitch_edit.rs's commit test. */
function estimateFundamental(samples: Float32Array): number {
    let bestCorrelation = Number.NEGATIVE_INFINITY;
    let bestLag = 0;
    const firstLag = Math.floor(SAMPLE_RATE / 1000);
    const lastLag = Math.min(Math.floor(SAMPLE_RATE / 50), Math.floor(samples.length / 2));
    for (let lag = firstLag; lag <= lastLag; lag++) {
        let correlation = 0;
        for (let frame = 0; frame < samples.length - lag; frame++) {
            correlation += samples[frame]! * samples[frame + lag]!;
        }
        if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestLag = lag;
        }
    }
    expect(bestCorrelation).toBeGreaterThan(0);
    expect(bestLag).toBeGreaterThan(0);
    return SAMPLE_RATE / bestLag;
}

function expectShiftedPcm(bufferId: string): AudioBuffer {
    const buffer = runtime.cache.audioBufferCache.get(bufferId);
    if (!buffer) {
        throw new Error('Committed clip references no actual rendered PCM');
    }
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.sampleRate).toBe(SAMPLE_RATE);
    expect(buffer.length).toBe(SAMPLE_RATE);
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    for (const channel of channels) {
        expect(channel.every(Number.isFinite)).toBe(true);
        expect(channel.reduce((energy, sample) => energy + sample * sample, 0)).toBeGreaterThan(0.01);
        const frequency = estimateFundamental(channel.slice(8192, 12288));
        const centsFromOctave = Math.abs(1200 * Math.log2(frequency / (SOURCE_HZ * 2)));
        expect(centsFromOctave).toBeLessThan(60);
    }
    expect(channels[1]).not.toEqual(channels[0]);
    return buffer;
}

beforeAll(async () => {
    database = installTransactionalIndexedDb();
    vi.stubGlobal('AudioBuffer', MockAudioBuffer);
    runtime = await importRuntime();
    runtime.projections.registerProjectSlotProjections();
    // Preinitialise the same unmodified generated module the production adapter
    // imports; its normal async init then returns this real realm singleton.
    runtime.dsp.initSync({
        module: new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'))),
    });
    setupComplete = true;
}, 30_000);

beforeEach(() => {
    publishedBufferIds.clear();
    vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
    configureAutomergeStoragePort(null);
    runtime.crdt.resetCrdtProjectAuthority('Committed Knead audio authority');
    runtime.crdt.removeCrdtDoc('root');
    runtime.crdt.createCrdtDoc('root');
    runtime.crdt.registerCrdtStorageRuntime();
    runtime.commandStores.clearHandlerRegistry();
    runtime.commandStores.registerHandlerMap(runtime.arrangement.getArrangementHandlers());
    runtime.commandStores.registerHandlerMap(runtime.knead.getPitchHandlers());
    runtime.commandStores.registerHandlerMap(runtime.transport.getTransportHandlers());
    runtime.command.resetActionReplayAuthority();
    runtime.command.setActionHistoryMetadataPort({
        record: runtime.crdt.recordActionHistoryEntry,
        recordBatch: runtime.crdt.recordActionHistoryEntries,
        markReverted: runtime.crdt.markActionHistoryEntryReverted,
        clear: runtime.crdt.clearActionHistory,
    });
    runtime.crdt.clearActionHistory();
    unsubscribeHistory = runtime.crdt.subscribeToPublishedActionHistory({
        onHistory: runtime.command.syncActionReplayMetadata,
        onRootReplaced: runtime.command.resetActionReplayAuthority,
    });
    runtime.command.clearUndoHistory();
    runtime.arrangement.setArrangementEventBus({ emit: () => Promise.resolve() });
    runtime.knead.resetKneadForProject();
    runtime.knead.setPitchEditDependencies({ commitPitchEdit: runtime.pitch.commitPitchEdit });
});

afterEach(async () => {
    if (!setupComplete) {
        return;
    }
    unsubscribeHistory?.();
    unsubscribeHistory = undefined;
    runtime.command.clearUndoHistory();
    runtime.command.resetActionReplayAuthority();
    runtime.commandStores.clearHandlerRegistry();
    runtime.knead.resetKneadForProject();
    await settlePublishedPcm([...publishedBufferIds]);
    await runtime.audio.clearRuntimeCachedAudioBuffers();
    runtime.crdt.removeCrdtDoc('root');
    configureAutomergeStoragePort(null);
});

afterAll(async () => {
    try {
        await database?.dispose();
    } finally {
        vi.unstubAllGlobals();
    }
});

describe('Knead committed pitch audio and project authority', () => {
    it('commits actual shifted stereo PCM and restores original media and analysis through real undo and redo', async () => {
        expect(isDesktopRuntime()).toBe(false);
        const channels = sourceChannels();
        const originalSnapshots = channels.map((channel) => channel.slice());
        const original = new AudioBuffer({ length: SAMPLE_RATE, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
        channels.forEach((channel, index) => original.copyToChannel(channel, index));
        runtime.audio.cacheAudioBuffer({ buffer: original, bufferId: SOURCE_BUFFER_ID });
        publishedBufferIds.add(SOURCE_BUFFER_ID);
        await settlePublishedPcm([SOURCE_BUFFER_ID]);

        await runtime.command.executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
        await runtime.command.executeAppAction({
            type: 'addTrack',
            payload: { id: TRACK_ID, name: 'Pitch source', kind: 'audio' },
        });
        await runtime.command.executeAppAction({
            type: 'addClip',
            payload: {
                id: CLIP_ID,
                trackId: TRACK_ID,
                startBeat: 0,
                endBeat: 2,
                name: 'One second source',
                type: 'audio',
                audioBufferId: SOURCE_BUFFER_ID,
            },
        });
        expect(projectedClip().audioBufferId).toBe(SOURCE_BUFFER_ID);
        expect(rawClip().audioBufferId).toBe(SOURCE_BUFFER_ID);

        // Real public analysis runs analyze_pitch_wasm over the actual cached
        // left channel and builds the editor's actual contour and note blobs.
        const analysis = await runtime.knead.analyzeClipPitch(CLIP_ID);
        expect(analysis.status).toBe('analyzed');
        const originalAnalysis = runtime.knead.captureClipPitchAnalysis(CLIP_ID);
        if (!originalAnalysis.contour || !originalAnalysis.blobs?.length) {
            throw new Error('Actual WASM pitch analysis did not produce restorable contour and blobs');
        }
        expect(originalAnalysis.contour.points.some((point) => point.voiced)).toBe(true);

        // addClip accepts a cache id but no source file identity. Use the actual
        // typed restore handler to seed that initial fixture without patching
        // the raw document or bypassing the owning mutation path.
        await runtime.command.executeAppAction({
            type: 'restoreClipFileId',
            payload: { clipId: CLIP_ID, fileId: SOURCE_FILE, audioBufferId: SOURCE_BUFFER_ID, ...originalAnalysis },
        });
        runtime.command.clearUndoHistory();
        runtime.crdt.clearActionHistory();
        const before = historyDepth();
        const durableBefore = durableHistoryDepth();
        const action = {
            type: 'commitPitchEdit' as const,
            payload: {
                clipId: CLIP_ID,
                segments: [{ start_time_ms: 0, end_time_ms: 1000, shift_semitones: 12 }],
                contour: originalAnalysis.contour,
                retuneSpeedMs: 0,
                formantPreserve: true,
            },
        };

        const completion = runtime.command.executeAppAction(action);
        expect(projectedClip().audioBufferId).toBe(SOURCE_BUFFER_ID);
        expect(rawClip().audioBufferId).toBe(SOURCE_BUFFER_ID);
        expect(historyDepth()).toBe(before);
        await completion;

        const renderedId = projectedClip().audioBufferId;
        if (!renderedId || renderedId === SOURCE_BUFFER_ID) {
            throw new Error('Pitch commit did not publish a new rendered buffer id');
        }
        publishedBufferIds.add(renderedId);
        await settlePublishedPcm([SOURCE_BUFFER_ID, renderedId]);
        expect(rawClip()).toMatchObject({
            audioBufferId: renderedId,
            fileId: `pitch-edits/${CLIP_ID}/source_pitch.wav`,
        });
        expect(projectedClip()).toMatchObject({
            audioBufferId: renderedId,
            fileId: `pitch-edits/${CLIP_ID}/source_pitch.wav`,
        });
        const rendered = expectShiftedPcm(renderedId);
        expect(historyDepth()).toBe(before + 1);
        expect(durableHistoryDepth()).toBe(durableBefore + 1);
        expect(runtime.kneadStores.kneadStore.value?.contours[CLIP_ID]).toBeUndefined();
        expect(runtime.kneadStores.kneadStore.value?.clips[CLIP_ID]?.blobs).toEqual([]);
        expect(rawClip().kneadState?.blobs).toEqual([]);
        originalSnapshots.forEach((snapshot, channel) => {
            expect(original.getChannelData(channel)).toEqual(snapshot);
            expect(channels[channel]).toEqual(snapshot);
        });

        await runtime.command.undo();
        expect(rawClip()).toMatchObject({ audioBufferId: SOURCE_BUFFER_ID, fileId: SOURCE_FILE });
        expect(projectedClip()).toMatchObject({ audioBufferId: SOURCE_BUFFER_ID, fileId: SOURCE_FILE });
        expect(runtime.cache.audioBufferCache.get(SOURCE_BUFFER_ID)).toBe(original);
        expect(runtime.knead.captureClipPitchAnalysis(CLIP_ID)).toEqual(originalAnalysis);
        expect(rawClip().kneadState?.blobs).toHaveLength(originalAnalysis.blobs.length);
        expect(historyDepth()).toBe(before);

        await runtime.command.redo();
        expect(rawClip().audioBufferId).toBe(renderedId);
        expect(projectedClip().audioBufferId).toBe(renderedId);
        await settlePublishedPcm([SOURCE_BUFFER_ID, renderedId]);
        const rerendered = expectShiftedPcm(renderedId);
        expect(rerendered).not.toBe(rendered);
        expect(historyDepth()).toBe(before + 1);
        originalSnapshots.forEach((snapshot, channel) => {
            expect(original.getChannelData(channel)).toEqual(snapshot);
        });

        // Read actual committed IDB records after dropping runtime material;
        // this is a PCM persistence witness, not a project-reopen simulation.
        const shiftedSnapshots = [rerendered.getChannelData(0).slice(), rerendered.getChannelData(1).slice()];
        await runtime.audio.clearRuntimeCachedAudioBuffers();
        const stored = await runtime.audio.prepareCachedAudioBuffersFromIdb({
            audioContext: {
                createBuffer: (numberOfChannels, length, sampleRate) =>
                    new AudioBuffer({ numberOfChannels, length, sampleRate }),
            },
            bufferIds: [SOURCE_BUFFER_ID, renderedId],
        });
        if (!stored) {
            throw new Error('Actual committed PCM records could not be read from IndexedDB');
        }
        try {
            expect(stored.publish()).toBe(2);
        } finally {
            stored.cancel();
        }
        originalSnapshots.forEach((snapshot, channel) => {
            expect(runtime.cache.audioBufferCache.get(SOURCE_BUFFER_ID)?.getChannelData(channel)).toEqual(snapshot);
            expect(runtime.cache.audioBufferCache.get(renderedId)?.getChannelData(channel)).toEqual(
                shiftedSnapshots[channel]
            );
        });
        expect(rawClip().audioBufferId).toBe(renderedId);
    });
});
