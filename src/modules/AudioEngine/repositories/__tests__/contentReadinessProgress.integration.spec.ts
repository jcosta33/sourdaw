import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { logger } from '#/infra/logger/appLogger';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { createTrack, setTrackState } from '#/modules/Arrangement/useCases';
import { defaultLevainState, levainStore } from '#/modules/Levain/stores';
import {
    acquireLevainNativeBank,
    configureLevainZoneTableBuilder,
    getDecodedBankDiagnostics,
    registerLevainDevice,
    unregisterLevainDevice,
} from '#/modules/Levain/useCases';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { buildLevainZoneTables } from '../../useCases/buildLevainZoneTables';
import { registerNativeSampleBanks } from '../nativeGraph/registerNativeSampleBanks';

import { createAudioEngineTopologyTestHarness as createAudioEngine } from './createAudioEngineTopologyTestHarness';

import type { LevainNodeResult } from '../../engine/LevainNode';

const levainFactory = vi.hoisted(() => ({ createLevainNode: vi.fn() }));

// The zone-table Worker does not exist under Node; build the tables in place.
vi.mock('../levainZoneTables/buildLevainZoneTablesInWorker', () => ({
    buildLevainZoneTablesInWorker: vi.fn(
        (request: { zones: readonly { zoneId: number }[]; numArticulations: number; numMics: number }) =>
            Promise.resolve({
                lut: new Uint32Array(request.numArticulations * request.numMics * 128 * 16 * 2),
                arena: Uint32Array.from(request.zones, (zone) => zone.zoneId),
            })
    ),
}));

vi.mock('../../engine/LevainNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/LevainNode')>()),
    createLevainNode: levainFactory.createLevainNode,
}));

const FILE_COUNT = 161;
const DEVICE_IDS = Array.from({ length: 5 }, (_, index) => `levain-${index}`);
let pendingWorkletAcks: Array<() => void> = [];
let endWorklets: Array<() => void> = [];

class FakeWorkletNode {
    readonly port = { postMessage: vi.fn(), close: vi.fn() };
    readonly connect = vi.fn();
    readonly disconnect = vi.fn();
}

function manifest(instrumentId = 'violin-1') {
    return {
        version: 1,
        instrumentId,
        sampleRate: 44_100,
        micPositions: ['close'],
        articulations: [
            {
                type: 'sustain',
                id: 0,
                zones: Array.from({ length: FILE_COUNT }, (_, index) => ({
                    file: `sample-${index}.wav`,
                    rootNote: 60,
                    loKey: 60,
                    hiKey: 60,
                    loVel: 64,
                    hiVel: 64,
                    rrPos: 0,
                    rrLen: 1,
                    micId: 0,
                    isRelease: false,
                    loopMode: 'none',
                    loopStart: 0,
                    loopEnd: 0,
                    loopCrossfade: 0,
                    gainDb: 0,
                    attack: 0,
                    decay: 0,
                    sustain: 1,
                    release: 0,
                })),
            },
        ],
    };
}

function createPort(): MessagePort {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    function emit(data: unknown): void {
        for (const listener of listeners) {
            listener({ data } as MessageEvent<unknown>);
        }
    }
    endWorklets.push(() => emit({ type: 'disposed' }));
    return {
        postMessage(message: { type: string; loadToken?: number; sampleId?: number }) {
            if (message.type === 'zoneTableChunk') {
                queueMicrotask(() => emit({ type: 'zoneTableChunkWritten', loadToken: message.loadToken }));
            }
            if (message.type === 'sampleChunk') {
                // The worklet writes each chunk and says so; the loader sends no
                // more than a few chunks ahead of these answers.
                queueMicrotask(() =>
                    emit({ type: 'sampleChunkWritten', loadToken: message.loadToken, sampleId: message.sampleId })
                );
            }
            if (message.type === 'beginSampleBank') {
                queueMicrotask(() =>
                    emit({
                        type: 'sampleBankUploadDecision',
                        loadToken: message.loadToken,
                        uploadRequired: true,
                    })
                );
            }
            if (message.type === 'commitSampleBank') {
                pendingWorkletAcks.push(() => emit({ type: 'sampleBankLoaded', loadToken: message.loadToken }));
            }
        },
        addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
            listeners.add(listener);
        },
        removeEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
            listeners.delete(listener);
        },
        close() {},
    } as MessagePort;
}

function createLevainResult(): LevainNodeResult {
    const port = createPort();
    const workletNode = {
        port,
        connect: vi.fn(),
        disconnect: vi.fn(),
    } as unknown as AudioWorkletNode;
    return {
        workletNode,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        noteExpression: vi.fn(),
        allNotesOff: vi.fn(),
        setParam: vi.fn(),
        handleCc: vi.fn(),
        discardStoredCc: vi.fn(),
        setBypass: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
        ready: Promise.resolve({}),
    };
}

function asAudioContext(context: MockAudioContext): AudioContext {
    return context as unknown as AudioContext;
}

function waitForDecodedCount(count: number): Promise<void> {
    return new Promise((resolve) => {
        const inspect = (): boolean =>
            DEVICE_IDS.every((id) => (levainStore.value?.[id]?.sampleLoadProgress ?? 0) >= count / FILE_COUNT);
        if (inspect()) {
            resolve();
            return;
        }
        const unsubscribe = levainStore.subscribe(() => {
            if (inspect()) {
                unsubscribe();
                resolve();
            }
        });
    });
}

describe('live Levain content progress', () => {
    let progressEvents: Array<{
        deviceId: string;
        epoch: number;
        progress: number | { type: 'activity' };
        atMs: number;
    }>;
    let progressChanged: PromiseWithResolvers<void>;

    async function waitForForwardedProgress(count: number): Promise<void> {
        while (
            !DEVICE_IDS.every((id) =>
                progressEvents.some(
                    (event) =>
                        event.deviceId === id &&
                        typeof event.progress === 'number' &&
                        event.progress >= count / FILE_COUNT
                )
            )
        ) {
            await progressChanged.promise;
            progressChanged = Promise.withResolvers<void>();
        }
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        vi.clearAllMocks();
        configureLevainZoneTableBuilder(buildLevainZoneTables);
        progressEvents = [];
        progressChanged = Promise.withResolvers<void>();
        pendingWorkletAcks = [];
        endWorklets = [];
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'OfflineAudioContext',
            class {
                decodeAudioData() {
                    return Promise.resolve({
                        numberOfChannels: 1,
                        length: 1,
                        sampleRate: 44_100,
                        getChannelData: () => new Float32Array([0.5]),
                    });
                }
            }
        );
        levainFactory.createLevainNode.mockImplementation(() => Promise.resolve(createLevainResult()));
        const track = createTrack({ id: 'track-1', name: 'Samples', kind: 'midi', withoutDefaultDevice: true });
        setTrackState({
            ...defaultTrackState,
            tracks: [
                {
                    ...track,
                    devices: DEVICE_IDS.map((id) => ({
                        id,
                        name: id,
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                    })),
                },
            ],
        });
        setAudioDeviceRuntimeSink({
            registerLevainDevice: ({ deviceId, device, port, onProgress }) =>
                registerLevainDevice(deviceId, device, port, (epoch, progress) => {
                    progressEvents.push({ deviceId, epoch, progress, atMs: Date.now() });
                    onProgress?.(epoch, progress);
                    progressChanged.resolve();
                }),
            unregisterLevainDevice,
        });
    });

    afterEach(() => {
        configureLevainZoneTableBuilder(null);
        setAudioDeviceRuntimeSink({});
        setTrackState(defaultTrackState);
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps five shared-bank live devices pending through the old cohort deadline while decoded files advance', async () => {
        levainStore.set(
            Object.fromEntries(
                DEVICE_IDS.map((id) => [
                    id,
                    { ...defaultLevainState, patch: { ...defaultLevainState.patch, instrumentId: 'solo-violin' } },
                ])
            )
        );
        const pendingSamples: Array<(response: unknown) => void> = [];
        let sampleRequested = Promise.withResolvers<void>();
        const fetchSample = () =>
            new Promise((resolve) => {
                pendingSamples.push(resolve);
                sampleRequested.resolve();
            });
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url.endsWith('/manifest.json')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest('solo-violin')) });
                }
                return fetchSample();
            })
        );
        const warnings = vi.spyOn(logger, 'warn');

        const engine = createAudioEngine(asAudioContext(createMockAudioContext()));
        try {
            for (const deviceId of DEVICE_IDS) {
                engine.addDeviceToStrip('track-1', deviceId, 'levain');
            }
            await vi.waitFor(() => expect(pendingSamples).toHaveLength(4));
            const waiting = engine.waitForDevices();
            const waitStartedAt = Date.now();
            let completed = false;
            void waiting.then(() => {
                completed = true;
            });

            for (let index = 0; index < 38; index++) {
                while (pendingSamples.length === 0) {
                    await sampleRequested.promise;
                    sampleRequested = Promise.withResolvers<void>();
                }
                pendingSamples.shift()!({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
            }
            await waitForDecodedCount(38);
            await waitForForwardedProgress(38);
            expect(getDecodedBankDiagnostics().decodedBytes).toBe(38 * 4);
            await vi.advanceTimersByTimeAsync(waitStartedAt + 9_990 - Date.now());
            while (pendingSamples.length === 0) {
                await sampleRequested.promise;
                sampleRequested = Promise.withResolvers<void>();
            }
            pendingSamples.shift()!({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
            await waitForDecodedCount(39);
            await waitForForwardedProgress(39);
            expect(getDecodedBankDiagnostics().decodedBytes).toBe(39 * 4);
            expect(
                progressEvents
                    .filter((event) => typeof event.progress === 'number' && event.progress >= 39 / FILE_COUNT)
                    .map((event) => event.deviceId)
            ).toEqual(DEVICE_IDS);
            expect(progressEvents.some((event) => event.progress === 0.01)).toBe(false);
            expect(
                progressEvents
                    .filter((event) => typeof event.progress === 'number' && event.progress >= 39 / FILE_COUNT)
                    .every((event) => event.atMs <= waitStartedAt + 9_990)
            ).toBe(true);
            await vi.advanceTimersByTimeAsync(20);

            expect(completed).toBe(false);
            expect(getDecodedBankDiagnostics().activeSampleLoads).toBe(4);
            expect(
                engine.getDeviceReadinessDiagnostics().devices.filter((device) => device.status === 'content-pending')
            ).toHaveLength(5);

            for (let index = 39; index < FILE_COUNT; index++) {
                while (pendingSamples.length === 0) {
                    await sampleRequested.promise;
                    sampleRequested = Promise.withResolvers<void>();
                }
                pendingSamples.shift()!({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
            }
            await waitForDecodedCount(FILE_COUNT);
            await vi.waitFor(() => expect(pendingWorkletAcks).toHaveLength(DEVICE_IDS.length));
            expect(completed).toBe(false);
            expect(
                engine.getDeviceReadinessDiagnostics().devices.filter((device) => device.status === 'content-pending')
            ).toHaveLength(5);
            for (const acknowledge of pendingWorkletAcks) {
                acknowledge();
            }
            await expect(waiting).resolves.toMatchObject({
                status: 'ready',
                devices: DEVICE_IDS.map((deviceId) => ({ deviceId, status: 'ready', stage: null })),
            });
            expect(
                engine.getDeviceReadinessDiagnostics().devices.filter((device) => device.status === 'ready')
            ).toHaveLength(5);
            expect(
                warnings.mock.calls.some(
                    ([message]) => typeof message === 'string' && /Device loading timed out|rolled back/.test(message)
                )
            ).toBe(false);
        } finally {
            for (const end of endWorklets) {
                end();
            }
            await engine.dispose();
        }
    });

    it('keeps five distinct queued banks pending beyond ten seconds only while predecessor work advances', async () => {
        const fileCount = 3;
        const instruments = ['violin-1', 'violin-2', 'viola', 'cello', 'double-bass'] as const;
        levainStore.set(
            Object.fromEntries(
                DEVICE_IDS.map((id, index) => [
                    id,
                    {
                        ...defaultLevainState,
                        patch: { ...defaultLevainState.patch, instrumentId: instruments[index]! },
                    },
                ])
            )
        );
        const samples: Array<{ url: string; resolve: (response: unknown) => void }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, options?: RequestInit) => {
                if (url.endsWith('/manifest.json')) {
                    const id = instruments.find((instrument) => url.includes(`/${instrument}/`))!;
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                ...manifest(id),
                                articulations: manifest(id).articulations.map((articulation) => ({
                                    ...articulation,
                                    zones: articulation.zones.slice(0, fileCount),
                                })),
                            }),
                    });
                }
                return new Promise((resolve, reject) => {
                    samples.push({ url, resolve });
                    options?.signal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('aborted', 'AbortError')),
                        { once: true }
                    );
                });
            })
        );
        const response = () => ({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
        const engine = createAudioEngine(asAudioContext(createMockAudioContext()));
        try {
            for (const deviceId of DEVICE_IDS) {
                engine.addDeviceToStrip('track-1', deviceId, 'levain');
            }
            await vi.waitFor(() => expect(samples).toHaveLength(fileCount));
            const waiting = engine.waitForDevices();
            for (let step = 0; step < 2; step++) {
                await vi.advanceTimersByTimeAsync(9000);
                samples.shift()!.resolve(response());
                await vi.waitFor(() =>
                    expect(progressEvents.filter((event) => typeof event.progress !== 'number')).toHaveLength(
                        (step + 1) * 4
                    )
                );
                expect(DEVICE_IDS.slice(1).map((id) => levainStore.value?.[id]?.sampleLoadProgress)).toEqual([
                    0, 0, 0, 0,
                ]);
                expect(samples.every(({ url }) => url.includes('/violin-1/'))).toBe(true);
            }
            expect(Date.now()).toBeGreaterThan(10000);
            expect(
                engine.getDeviceReadinessDiagnostics().devices.filter((device) => device.status === 'content-pending')
            ).toHaveLength(5);
            for (let bank = 0; bank < instruments.length; bank++) {
                const alreadyDecoded = bank === 0 ? 2 : 0;
                for (let file = alreadyDecoded; file < fileCount; file++) {
                    await vi.waitFor(() => expect(samples.length).toBeGreaterThan(0));
                    const next = samples.shift()!;
                    expect(next.url).toContain(`/${instruments[bank]}/`);
                    next.resolve(response());
                }
                await vi.waitFor(() => expect(pendingWorkletAcks).toHaveLength(bank + 1));
                // Shipment acknowledgements also renew queued followers, without a UI increment.
                await vi.advanceTimersByTimeAsync(9000);
                pendingWorkletAcks[bank]!();
            }
            await expect(waiting).resolves.toMatchObject({ status: 'ready' });
            expect(
                engine.getDeviceReadinessDiagnostics().devices.filter((device) => device.status === 'ready')
            ).toHaveLength(5);
        } finally {
            for (const end of endWorklets) {
                end();
            }
            await engine.dispose();
        }
    });

    it('renews a live queued bank from native acknowledgements and admits it after native shipment failure', async () => {
        const fileCount = 3;
        const deviceId = DEVICE_IDS[0]!;
        levainStore.set({
            [deviceId]: { ...defaultLevainState, patch: { ...defaultLevainState.patch, instrumentId: 'solo-trumpet' } },
        });
        const samples: Array<(value: unknown) => void> = [];
        const response = () => ({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, options?: RequestInit) => {
                if (url.endsWith('/manifest.json')) {
                    const native = url.includes('/solo-viola/');
                    const source = manifest(native ? 'solo-viola' : 'solo-trumpet');
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                ...source,
                                articulations: source.articulations.map((articulation) => ({
                                    ...articulation,
                                    zones: articulation.zones.slice(0, native ? 1 : fileCount),
                                })),
                            }),
                    });
                }
                if (url.includes('/solo-viola/')) {
                    return Promise.resolve(response());
                }
                return new Promise((resolve, reject) => {
                    samples.push(resolve);
                    options?.signal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('aborted', 'AbortError')),
                        { once: true }
                    );
                });
            })
        );
        const begin = Promise.withResolvers<unknown>();
        const sample = Promise.withResolvers<unknown>();
        const commit = Promise.withResolvers<unknown>();
        const beginCalled = vi.fn(() => begin.promise);
        const sampleCalled = vi.fn(() => sample.promise);
        const commitCalled = vi.fn(() => commit.promise);
        const native = registerNativeSampleBanks({
            backendId: 'queued-native-test',
            commands: [
                {
                    kind: 'insert-device',
                    trackId: 'native-track',
                    index: 0,
                    device: {
                        id: 'native-levain',
                        name: 'Native Levain',
                        type: 'levain',
                        bypassed: false,
                        parameterValues: {},
                        sampleBankKey: 'levain:solo-viola',
                    },
                },
            ],
            acquire: acquireLevainNativeBank,
            transport: {
                beginLevainBank: beginCalled,
                registerLevainSample: sampleCalled,
                commitLevainBank: commitCalled,
                releaseLevainBank: () => Promise.resolve(null),
                registerTimelineSample: () => Promise.reject(new Error('unexpected timeline sample')),
                renderGraphOffline: () => Promise.reject(new Error('unexpected render')),
                applyGraphCommands: () => Promise.reject(new Error('unexpected apply')),
                mapGraphBatch: () => Promise.reject(new Error('unexpected map')),
            },
        });
        await vi.waitFor(() => expect(beginCalled).toHaveBeenCalledOnce());
        const engine = createAudioEngine(asAudioContext(createMockAudioContext()));
        try {
            engine.addDeviceToStrip('track-1', deviceId, 'levain');
            await vi.waitFor(() => expect(levainStore.value?.[deviceId]?.sampleLoadProgress).toBe(0));
            const waiting = engine.waitForDevices();
            await vi.advanceTimersByTimeAsync(9000);
            begin.resolve(null);
            await vi.waitFor(() => expect(sampleCalled).toHaveBeenCalledOnce());
            expect(progressEvents.filter((event) => typeof event.progress !== 'number')).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(9000);
            sample.resolve(null);
            await vi.waitFor(() => expect(commitCalled).toHaveBeenCalledOnce());
            expect(progressEvents.filter((event) => typeof event.progress !== 'number')).toHaveLength(2);
            expect(engine.getDeviceReadinessDiagnostics().devices[0]?.status).toBe('content-pending');
            expect(levainStore.value?.[deviceId]?.sampleLoadProgress).toBe(0);
            expect(samples).toHaveLength(0);
            commit.reject(new Error('native commit refused'));
            await expect(native).resolves.toEqual([]);
            for (let file = 0; file < fileCount; file++) {
                await vi.waitFor(() => expect(samples.length).toBeGreaterThan(0));
                samples.shift()!(response());
            }
            await vi.waitFor(() => expect(pendingWorkletAcks).toHaveLength(1));
            pendingWorkletAcks[0]!();
            await expect(waiting).resolves.toMatchObject({ status: 'ready' });
            expect(getDecodedBankDiagnostics().activeLeases).toBe(0);
        } finally {
            for (const end of endWorklets) {
                end();
            }
            await engine.dispose();
        }
    });

    it('times out queued banks when their predecessor makes no progress for ten seconds', async () => {
        const instruments = ['flute', 'oboe'] as const;
        levainStore.set(
            Object.fromEntries(
                DEVICE_IDS.slice(0, 2).map((id, index) => [
                    id,
                    {
                        ...defaultLevainState,
                        patch: { ...defaultLevainState.patch, instrumentId: instruments[index]! },
                    },
                ])
            )
        );
        const pending: Array<(value: unknown) => void> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string, options?: RequestInit) => {
                if (url.endsWith('/manifest.json')) {
                    const id = instruments.find((instrument) => url.includes(`/${instrument}/`))!;
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest(id)) });
                }
                return new Promise((resolve, reject) => {
                    pending.push(resolve);
                    options?.signal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('aborted', 'AbortError')),
                        { once: true }
                    );
                });
            })
        );
        const engine = createAudioEngine(asAudioContext(createMockAudioContext()));
        try {
            for (const deviceId of DEVICE_IDS.slice(0, 2)) {
                engine.addDeviceToStrip('track-1', deviceId, 'levain');
            }
            await vi.waitFor(() => expect(pending).toHaveLength(4));
            const waiting = engine.waitForDevices();
            await vi.advanceTimersByTimeAsync(10000);
            await expect(waiting).resolves.toMatchObject({
                status: 'failed',
                devices: [
                    { deviceId: DEVICE_IDS[0], status: 'failed', stage: 'content' },
                    { deviceId: DEVICE_IDS[1], status: 'failed', stage: 'content' },
                ],
            });
            for (const resolve of pending) {
                resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
            }
        } finally {
            for (const end of endWorklets) {
                end();
            }
            await engine.dispose();
        }
    });

    it('fails content readiness when every file decodes but the worklet never acknowledges the bank', async () => {
        levainStore.set({
            [DEVICE_IDS[0]!]: {
                ...defaultLevainState,
                patch: { ...defaultLevainState.patch, instrumentId: 'solo-cello' },
            },
        });
        const pendingSamples: Array<(response: unknown) => void> = [];
        let sampleRequested = Promise.withResolvers<void>();
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url.endsWith('/manifest.json')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest('solo-cello')) });
                }
                return new Promise((resolve) => {
                    pendingSamples.push(resolve);
                    sampleRequested.resolve();
                });
            })
        );

        const engine = createAudioEngine(asAudioContext(createMockAudioContext()));
        try {
            engine.addDeviceToStrip('track-1', DEVICE_IDS[0]!, 'levain');
            await vi.waitFor(() => expect(pendingSamples).toHaveLength(4));
            const waiting = engine.waitForDevices();
            for (let index = 0; index < FILE_COUNT; index++) {
                while (pendingSamples.length === 0) {
                    await sampleRequested.promise;
                    sampleRequested = Promise.withResolvers<void>();
                }
                pendingSamples.shift()!({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
            }
            await vi.waitFor(() => expect(pendingWorkletAcks).toHaveLength(1));
            expect(engine.getDeviceReadinessDiagnostics().devices[0]?.status).toBe('content-pending');

            await vi.advanceTimersByTimeAsync(10000);
            await expect(waiting).resolves.toMatchObject({
                status: 'failed',
                devices: [{ deviceId: DEVICE_IDS[0], status: 'failed', stage: 'content' }],
            });
            pendingWorkletAcks[0]!();
            expect(engine.getDeviceReadinessDiagnostics().devices[0]).toMatchObject({
                status: 'failed',
                failureStage: 'content',
            });
        } finally {
            for (const end of endWorklets) {
                end();
            }
            await engine.dispose();
        }
    });
});
