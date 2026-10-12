import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { logger } from '#/infra/logger/appLogger';
import { defaultTrackState } from '#/modules/Arrangement/stores';
import { createTrack, setTrackState } from '#/modules/Arrangement/useCases';
import { defaultLevainState, levainStore } from '#/modules/Levain/stores';
import { getDecodedBankDiagnostics, registerLevainDevice, unregisterLevainDevice } from '#/modules/Levain/useCases';

import { setAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';

import { createAudioEngineTopologyTestHarness as createAudioEngine } from './createAudioEngineTopologyTestHarness';

import type { LevainNodeResult } from '../../engine/LevainNode';

const levainFactory = vi.hoisted(() => ({ createLevainNode: vi.fn() }));

vi.mock('../../engine/LevainNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../engine/LevainNode')>()),
    createLevainNode: levainFactory.createLevainNode,
}));

const FILE_COUNT = 161;
const DEVICE_IDS = Array.from({ length: 5 }, (_, index) => `levain-${index}`);
let pendingWorkletAcks: Array<() => void> = [];

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
    return {
        postMessage(message: { type: string; loadToken?: number; sampleId?: number }) {
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
            if (message.type === 'buildZoneMap') {
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
    let progressEvents: Array<{ deviceId: string; epoch: number; progress: number; atMs: number }>;
    let progressChanged: PromiseWithResolvers<void>;

    async function waitForForwardedProgress(count: number): Promise<void> {
        while (
            !DEVICE_IDS.every((id) =>
                progressEvents.some((event) => event.deviceId === id && event.progress >= count / FILE_COUNT)
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
        progressEvents = [];
        progressChanged = Promise.withResolvers<void>();
        pendingWorkletAcks = [];
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
        setAudioDeviceRuntimeSink({});
        setTrackState(defaultTrackState);
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('keeps five shared-bank live devices pending through the old cohort deadline while decoded files advance', async () => {
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
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest()) });
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
                progressEvents.filter((event) => event.progress >= 39 / FILE_COUNT).map((event) => event.deviceId)
            ).toEqual(DEVICE_IDS);
            expect(progressEvents.some((event) => event.progress === 0.01)).toBe(false);
            expect(
                progressEvents
                    .filter((event) => event.progress >= 39 / FILE_COUNT)
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
            await engine.dispose();
        }
    });

    it('fails content readiness when every file decodes but the worklet never acknowledges the bank', async () => {
        levainStore.set({
            [DEVICE_IDS[0]!]: {
                ...defaultLevainState,
                patch: { ...defaultLevainState.patch, instrumentId: 'cello' },
            },
        });
        const pendingSamples: Array<(response: unknown) => void> = [];
        let sampleRequested = Promise.withResolvers<void>();
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url.endsWith('/manifest.json')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest('cello')) });
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
            await engine.dispose();
        }
    });
});
