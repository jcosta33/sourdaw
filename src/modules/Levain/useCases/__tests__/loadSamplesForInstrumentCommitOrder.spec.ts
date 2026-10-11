import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../repositories/sampleLoader/fetchAndDecode', () => {
    const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 2);
    return {
        fetchAndDecode: vi.fn().mockResolvedValue({
            data: new Float32Array(buffer),
            frameCount: 1,
            channels: 2,
            sampleRate: 44100,
        }),
    };
});

import { createDefaultPatch, type MicPositionType } from '../../models/LevainPatch';
import { decodedBankResource } from '../../repositories/sampleLoader/decodedBankResource';
import { defaultLevainState, levainStore } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';
import { createLevainBridge } from '../levainParamBridge/helpers';

// ---------------------------------------------------------------------------
// Integration: the real `autoLoadLevainSamples` and the real
// `loadInstrumentFromManifest` against a fake port modelled on the
// processor's own commit/reply timing — proving the bridge's
// last-committed-wins ordering (`recordCommittedBank` in
// `levainParamBridge/helpers.ts`) survives the abort-after-buildZoneMap
// repair in `loadInstrumentFromManifest.ts`: a load whose worklet commit is
// still in flight when a newer load supersedes it must still have its commit
// recorded before a later rejection reads it back.
// ---------------------------------------------------------------------------

type Manifest = {
    version: number;
    instrumentId: string;
    sampleRate: number;
    micPositions: string[];
    articulations: Array<{
        type: string;
        id: number;
        zones: Array<Record<string, unknown>>;
    }>;
};

function makeZone(file: string, micId: number): Record<string, unknown> {
    return {
        file,
        rootNote: 60,
        loKey: 0,
        hiKey: 127,
        loVel: 0,
        hiVel: 127,
        rrPos: 0,
        rrLen: 1,
        micId,
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
    };
}

const MANIFEST_A: Manifest = {
    version: 1,
    instrumentId: 'cello',
    sampleRate: 44100,
    micPositions: ['close'],
    articulations: [{ type: 'sustain', id: 0, zones: [makeZone('a.wav', 0)] }],
};

const MANIFEST_B: Manifest = {
    version: 1,
    instrumentId: 'viola',
    sampleRate: 44100,
    micPositions: ['room', 'close'],
    articulations: [{ type: 'sustain', id: 0, zones: [makeZone('b-room.wav', 0), makeZone('b-close.wav', 1)] }],
};

const MANIFEST_C: Manifest = {
    version: 1,
    instrumentId: 'oboe',
    sampleRate: 44100,
    micPositions: ['close'],
    articulations: [{ type: 'sustain', id: 0, zones: [makeZone('c.wav', 0)] }],
};

const MANIFEST_SPARSE: Manifest = {
    version: 1,
    instrumentId: 'trumpet',
    sampleRate: 44100,
    micPositions: ['close', 'room'],
    articulations: [{ type: 'sustain', id: 0, zones: [makeZone('room.wav', 1)] }],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

type ReplyMode = 'auto' | 'defer' | 'fail';

/**
 * A fake worklet port modelled on `levainProcessor.ts`'s own token bookkeeping
 * (~:178, ~:285-343, ~:513-517): one `_bankLoadToken`-equivalent shared across
 * every load on this device's port, cleared synchronously on commit. `replies`
 * assigns one behaviour per `beginSampleBank` call in start order: `'auto'`
 * commits and answers `buildZoneMap` on the next microtask; `'defer'` commits
 * (clearing the token, so a later abort finds no match) but leaves the test to
 * deliver the terminal `sampleBankLoaded` itself; `'fail'` answers with
 * `sampleBankError` instead of committing.
 */
function makeSequencedPort(replies: ReplyMode[]): {
    port: MessagePort & { postMessage: ReturnType<typeof vi.fn>; emit: (message: unknown) => void };
    deferredToken: (callIndex: number) => number;
} {
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    let pendingToken: number | null = null;
    let callIndex = -1;
    const deferredTokens = new Map<number, number>();
    function emit(message: unknown): void {
        const event = { data: message } as MessageEvent<unknown>;
        for (const listener of listeners) {
            listener(event);
        }
    }
    const postMessage = vi.fn((message: unknown) => {
        if (!isRecord(message) || typeof message.loadToken !== 'number') {
            return;
        }
        if (message.type === 'beginSampleBank') {
            callIndex += 1;
            pendingToken = message.loadToken;
            queueMicrotask(() => {
                emit({ type: 'sampleBankUploadDecision', loadToken: message.loadToken, uploadRequired: true });
            });
            return;
        }
        if (message.type === 'buildZoneMap') {
            const mode = replies[callIndex] ?? 'auto';
            if (mode === 'defer') {
                // Mirrors the real processor clearing `_bankLoadToken`
                // synchronously on commit, before the reply is even queued.
                pendingToken = null;
                deferredTokens.set(callIndex, message.loadToken);
                return;
            }
            pendingToken = null;
            queueMicrotask(() => {
                if (mode === 'fail') {
                    emit({ type: 'sampleBankError', loadToken: message.loadToken, message: 'zone map rejected' });
                    return;
                }
                emit({ type: 'sampleBankLoaded', loadToken: message.loadToken });
            });
            return;
        }
        if (message.type === 'releaseRetiredBank') {
            // The real processor answers every release request, and the loader
            // holds the next load's begin until it reports done.
            queueMicrotask(() => {
                emit({ type: 'retiredBankReleased', loadToken: message.loadToken, done: true });
            });
            return;
        }
        if (message.type === 'abortSampleBank') {
            if (message.loadToken !== pendingToken) {
                // Already committed (token cleared) or a stale token: the
                // real processor's matched-token guard makes this a no-op.
                return;
            }
            pendingToken = null;
            queueMicrotask(() => {
                emit({
                    type: 'sampleBankError',
                    loadToken: message.loadToken,
                    message: 'Levain sample bank load was aborted',
                });
            });
        }
    });
    return {
        port: {
            postMessage,
            addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
                if (typeof listener === 'function') {
                    listeners.add(listener);
                }
            },
            removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
                if (typeof listener === 'function') {
                    listeners.delete(listener);
                }
            },
            emit,
        } as unknown as MessagePort & { postMessage: ReturnType<typeof vi.fn>; emit: (message: unknown) => void },
        deferredToken: (index: number): number => {
            const token = deferredTokens.get(index);
            if (token === undefined) {
                throw new Error(`Expected a deferred buildZoneMap reply for call ${index}`);
            }
            return token;
        },
    };
}

function seedDevice(deviceId: string): void {
    levainStore.set({
        [deviceId]: { ...defaultLevainState, patch: createDefaultPatch('violin-1'), loadedMicPositions: null },
    });
}

function makeDeps(autoLoad: typeof autoLoadLevainSamples) {
    return {
        getAllTracks: vi.fn(() => []),
        persistDeviceParam: vi.fn(),
        writeNativeBuiltinParameters: vi.fn(),
        sendNativeLiveMidiControl: vi.fn(() => Promise.resolve(true)),
        autoLoadLevainSamples: autoLoad,
        setLoadedMicPositions: (id: string, positions: readonly (MicPositionType | null)[] | null) => {
            const instances = levainStore.value ?? {};
            const state = instances[id];
            if (!state) {
                return;
            }
            levainStore.set({ ...instances, [id]: { ...state, loadedMicPositions: positions } });
        },
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string): DeviceWriteTargetResolution => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        })),
    };
}

describe('loadSamplesForInstrument — real autoLoadLevainSamples + real loader, commit order across a supersession', () => {
    beforeEach(() => {
        decodedBankResource.clear();
        levainStore.set({});
        vi.stubGlobal(
            'fetch',
            vi.fn((url: string) => {
                if (url.includes('/cello/')) {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANIFEST_A) });
                }
                if (url.includes('/viola/')) {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANIFEST_B) });
                }
                if (url.includes('/oboe/')) {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANIFEST_C) });
                }
                if (url.includes('/trumpet/')) {
                    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(MANIFEST_SPARSE) });
                }
                return Promise.reject(new Error(`unexpected manifest url ${url}`));
            })
        );
    });

    it('commits only Room availability at engine mic 1 from a real sparse manifest', async () => {
        const deviceId = 'device-1';
        seedDevice(deviceId);
        const { port } = makeSequencedPort(['auto']);
        const bridge = createLevainBridge(makeDeps(autoLoadLevainSamples));
        const device = { setParam: vi.fn(), handleCc: vi.fn() };
        await bridge.registerLevainDevice(deviceId, device, port);

        await expect(bridge.loadSamplesForInstrument(deviceId, 'trumpet')).resolves.toBe('ready');
        expect(levainStore.value?.[deviceId]?.loadedMicPositions).toEqual([null, 'room']);
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'addZone', micId: 1 }));
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'buildZoneMap', numMics: 2 }));

        device.setParam.mockClear();
        bridge.setMacroWithAudio(deviceId, 4, 0.6);
        expect(device.setParam).toHaveBeenCalledWith('mic_1_volume', 0.6);
        expect(device.setParam).not.toHaveBeenCalledWith('mic_0_volume', expect.any(Number));
    });

    afterEach(() => {
        decodedBankResource.clear();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('keeps the last committed bank (B) after a later load (C) is superseded mid-commit and then rejects', async () => {
        const deviceId = 'device-1';
        seedDevice(deviceId);
        const { port, deferredToken } = makeSequencedPort(['auto', 'defer', 'fail']);
        const autoLoadSpy = vi.fn(autoLoadLevainSamples);
        const deps = makeDeps(autoLoadSpy);
        const bridge = createLevainBridge(deps);

        // `registerLevainDevice` is what actually populates the bridge's
        // `activePorts` map that `loadSamplesForInstrument` reads — without
        // it every call below would short-circuit to 'failed' before ever
        // reaching `autoLoadLevainSamples`. It also fires its own initial
        // load for the seeded patch's instrument ('violin-1'), which this
        // suite does not mock a manifest for, so it fails fast without ever
        // reaching the port (no `beginSampleBank`) — awaited and cleared so
        // it cannot interleave with A/B/C or shift the spy's call indices.
        const device = { setParam: vi.fn(), handleCc: vi.fn() };
        await bridge.registerLevainDevice(deviceId, device, port);
        autoLoadSpy.mockClear();
        port.postMessage.mockClear();

        // A: committed and not superseded — writes the store directly.
        await bridge.loadSamplesForInstrument(deviceId, 'cello');
        expect(levainStore.value?.[deviceId]?.loadedMicPositions).toEqual(['close']);

        // B: the worklet commits (buildZoneMap posted; the fake port's
        // `_bankLoadToken`-equivalent is already cleared) but its reply is
        // held back — modelling the exact race the repair targets. Cleared
        // first so the wait below observes only B's own `buildZoneMap`, not
        // A's already-posted one.
        port.postMessage.mockClear();
        void bridge.loadSamplesForInstrument(deviceId, 'viola');
        await vi.waitFor(() => {
            expect(port.postMessage.mock.calls.some(([m]) => isRecord(m) && m.type === 'buildZoneMap')).toBe(true);
        });
        const bLoadPromise = autoLoadSpy.mock.results[1]?.value as ReturnType<typeof autoLoadLevainSamples>;
        expect(bLoadPromise).toBeDefined();

        // C starts before B's reply is delivered — this abandons (aborts)
        // B, exactly as `loadSamplesForInstrument`'s successor cancellation
        // does for any two overlapping loads on one device.
        const cDone = bridge.loadSamplesForInstrument(deviceId, 'oboe');

        // Deliver B's held-back reply now that it has been superseded. The
        // loader resolves with the bank (the repair's core behaviour); the
        // bridge records the commit but — since B's own signal is now
        // aborted — does not write the store. Awaiting the same promise the
        // bridge is itself chained from guarantees its `recordCommittedBank`
        // call (attached first) has already run before this resumes.
        port.emit({ type: 'sampleBankLoaded', loadToken: deferredToken(1) });
        await bLoadPromise;

        // C's own worklet commit fails; the bridge restores the
        // last-committed bank, which must be B's, not A's stale record.
        await expect(cDone).resolves.toBe('failed');

        expect(levainStore.value?.[deviceId]?.loadedMicPositions).toEqual(['room', 'close']);
    });

    describe('a superseded load whose worklet commit outlives its successor’s own rejection', () => {
        it('still shows the superseded load’s bank once the fake port finally answers it', async () => {
            const deviceId = 'device-1';
            seedDevice(deviceId);
            // Only A ever posts `buildZoneMap` — B's own manifest fetch fails
            // before it reaches the port (see the `beforeEach` fetch mock's
            // fallback for any unmocked instrument), so the sequenced port's
            // call-index bookkeeping only needs an entry for A.
            const { port, deferredToken } = makeSequencedPort(['defer']);
            const autoLoadSpy = vi.fn(autoLoadLevainSamples);
            const deps = makeDeps(autoLoadSpy);
            const bridge = createLevainBridge(deps);

            const device = { setParam: vi.fn(), handleCc: vi.fn() };
            await bridge.registerLevainDevice(deviceId, device, port);
            autoLoadSpy.mockClear();
            port.postMessage.mockClear();

            // A: worklet commit staged (`buildZoneMap` posted) but held back.
            const loadA = bridge.loadSamplesForInstrument(deviceId, 'cello');
            await vi.waitFor(() => {
                expect(port.postMessage.mock.calls.some(([m]) => isRecord(m) && m.type === 'buildZoneMap')).toBe(true);
            });
            const aLoadPromise = autoLoadSpy.mock.results[0]?.value as ReturnType<typeof autoLoadLevainSamples>;
            expect(aLoadPromise).toBeDefined();

            // B supersedes (aborts) A, then rejects on its own — its manifest
            // fetch fails before it ever reaches the worklet.
            const loadB = bridge.loadSamplesForInstrument(deviceId, 'flute');

            await expect(loadB).resolves.toBe('failed');
            await expect(loadA).resolves.toBe('failed'); // A defers to its successor, B.

            // A's worklet handshake commits after B already rejected. The
            // commitment already happened in the engine, so the panel must
            // still end up showing A's names rather than staying on whatever
            // B's rejection last published.
            port.emit({ type: 'sampleBankLoaded', loadToken: deferredToken(0) });
            await aLoadPromise;

            expect(levainStore.value?.[deviceId]?.loadedMicPositions).toEqual(['close']);
        });
    });
});
