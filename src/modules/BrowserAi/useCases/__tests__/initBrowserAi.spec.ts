import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const subscribe_to_midi_store = vi.hoisted(() =>
    vi.fn<(callback: (next: { notesByClipId: Record<string, unknown[]> } | null) => void) => () => void>(
        () => () => undefined
    )
);

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        subscribe: subscribe_to_midi_store,
    },
}));

import { type CapabilityReport } from '../../models/CapabilityReport';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { KOKORO_MODEL_ARTIFACT } from '../../models/KokoroArtifactManifest';
import { capabilityStore } from '../../stores/capabilityStore';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { initBrowserAi } from '../initBrowserAi';

type DetectCapabilitiesRepo = (input?: {
    forceRefresh?: boolean;
    measureInference?: boolean;
}) => Promise<CapabilityReport>;
type CheckVerifiedModel = (input: {
    family: string;
    modelId: string;
    sha256: string;
    sizeBytes: number;
}) => Promise<boolean>;

type CheckDdspInstrumentReady = (input: { id: string; version: string; artifacts: unknown[] }) => Promise<boolean>;
type WithDdspInstrumentLock = (
    instrumentId: string,
    mode: 'shared' | 'exclusive',
    operation: () => Promise<unknown>
) => Promise<unknown>;

type LoggerMock = {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
};

function create_logger_mock(): LoggerMock {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };
}

const pass_through_lock = vi.fn<WithDdspInstrumentLock>(async (_instrumentId, _mode, operation) => operation());

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolveDeferred = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

function create_instrument_lock(): ReturnType<typeof vi.fn<WithDdspInstrumentLock>> {
    type Pending = {
        mode: 'shared' | 'exclusive';
        operation: () => Promise<unknown>;
        resolve: (value: unknown) => void;
        reject: (reason: unknown) => void;
    };
    type State = { activeExclusive: boolean; activeShared: number; queue: Pending[] };
    const states = new Map<string, State>();
    const stateFor = (instrumentId: string): State => {
        const existing = states.get(instrumentId);
        if (existing) {
            return existing;
        }
        const created = { activeExclusive: false, activeShared: 0, queue: [] };
        states.set(instrumentId, created);
        return created;
    };
    const drain = (instrumentId: string): void => {
        const state = stateFor(instrumentId);
        if (state.activeExclusive || state.queue.length === 0) {
            return;
        }
        const run = (pending: Pending): void => {
            const finish = (): void => {
                if (pending.mode === 'exclusive') {
                    state.activeExclusive = false;
                } else {
                    state.activeShared -= 1;
                }
                drain(instrumentId);
            };
            void pending.operation().then(pending.resolve, pending.reject).finally(finish);
        };
        if (state.queue[0]?.mode === 'exclusive') {
            if (state.activeShared > 0) {
                return;
            }
            state.activeExclusive = true;
            run(state.queue.shift()!);
            return;
        }
        while (state.queue[0]?.mode === 'shared') {
            state.activeShared += 1;
            run(state.queue.shift()!);
        }
    };
    return vi.fn<WithDdspInstrumentLock>(
        (instrumentId, mode, operation) =>
            new Promise((resolve, reject) => {
                stateFor(instrumentId).queue.push({ mode, operation, resolve, reject });
                drain(instrumentId);
            })
    );
}

const fresh_capability_report: CapabilityReport = {
    capability: 'supported',
    webGpu: { status: 'supported' },
    webGpuTier: 'webgpu-fast',
    crossOriginIsolated: true,
    workerAvailable: true,
    opfsAvailable: true,
    inference: {
        status: 'measured',
        modelId: KOKORO_MODEL_ARTIFACT.id,
        executionProviders: ['webgpu', 'wasm'],
        audioSeconds: 4,
        elapsedSeconds: 2,
        realtimeFactor: 2,
    },
    detectedAt: 1_803_556_800_000,
};

describe('initBrowserAi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capabilityStore.set({ phase: 'idle' });
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
        Reflect.deleteProperty(globalThis.navigator, 'storage');
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis.navigator, 'storage');
    });

    it('should force a capability re-probe on cold start instead of allowing a cached report', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        // App startup takes the platform facts only. The throughput probe renders a
        // full Kokoro phrase; paying that on every boot is not acceptable, so the
        // flag must stay off here.
        expect(detect_capabilities_repo).toHaveBeenCalledWith({ forceRefresh: true, measureInference: false });
        expect(capabilityStore.value).toEqual({ phase: 'done', report: fresh_capability_report });
        expect(subscribe_to_midi_store).toHaveBeenCalledTimes(1);
        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
                ...instrument,
                status: 'not-downloaded',
                downloadProgress: 0,
            }))
        );
    });

    it('should derive DDSP readiness from the complete validated OPFS artifact set', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        const check_ddsp_instrument_ready = vi.fn<CheckDdspInstrumentReady>().mockResolvedValue(true);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toHaveLength(4);
        expect(modelRegistryStore.value?.ddspInstruments.every((instrument) => instrument.status === 'ready')).toBe(
            true
        );
        expect(check_ddsp_instrument_ready).toHaveBeenCalledTimes(DDSP_INSTRUMENT_CATALOG.length);
        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('not-downloaded');
        expect(check_verified_model).toHaveBeenCalledWith({
            family: 'kokoro',
            modelId: KOKORO_MODEL_ARTIFACT.id,
            sha256: KOKORO_MODEL_ARTIFACT.sha256,
            sizeBytes: KOKORO_MODEL_ARTIFACT.sizeBytes,
        });
        expect(modelRegistryStore.value?.vocoder).toBeNull();
    });

    it('should wait behind an exclusive publication before persisting startup readiness', async () => {
        const instrument = DDSP_INSTRUMENT_CATALOG[0];
        const publicationGate = deferred();
        const events: string[] = [];
        let published = false;
        const with_ddsp_instrument_lock = create_instrument_lock();
        const publication = with_ddsp_instrument_lock(instrument.id, 'exclusive', async () => {
            events.push('publish-start');
            await publicationGate.promise;
            published = true;
            events.push('publish-end');
        });
        await vi.waitFor(() => expect(events).toEqual(['publish-start']));
        const check_ddsp_instrument_ready = vi.fn<CheckDdspInstrumentReady>(async ({ id }) =>
            id === instrument.id ? published : false
        );
        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn<CheckVerifiedModel>().mockResolvedValue(false),
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            withDdspInstrumentLock: with_ddsp_instrument_lock,
        });

        const initialization = initBrowserAi();
        await vi.waitFor(() =>
            expect(check_ddsp_instrument_ready).toHaveBeenCalledWith(
                expect.objectContaining({ id: DDSP_INSTRUMENT_CATALOG[1]?.id })
            )
        );
        expect(check_ddsp_instrument_ready).not.toHaveBeenCalledWith(expect.objectContaining({ id: instrument.id }));

        publicationGate.resolve();
        await Promise.all([publication, initialization]);

        expect(modelRegistryStore.value?.ddspInstruments.find(({ id }) => id === instrument.id)).toMatchObject({
            status: 'ready',
            downloadProgress: 1,
        });
        expect(events).toEqual(['publish-start', 'publish-end']);
    });

    it('should wait behind exclusive removal before persisting startup not-downloaded truth', async () => {
        const instrument = DDSP_INSTRUMENT_CATALOG[0];
        const removalGate = deferred();
        let ready = true;
        const with_ddsp_instrument_lock = create_instrument_lock();
        const removal = with_ddsp_instrument_lock(instrument.id, 'exclusive', async () => {
            await removalGate.promise;
            ready = false;
        });
        const check_ddsp_instrument_ready = vi.fn<CheckDdspInstrumentReady>(async ({ id }) =>
            id === instrument.id ? ready : false
        );
        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn<CheckVerifiedModel>().mockResolvedValue(false),
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            withDdspInstrumentLock: with_ddsp_instrument_lock,
        });

        const initialization = initBrowserAi();
        await vi.waitFor(() =>
            expect(check_ddsp_instrument_ready).toHaveBeenCalledWith(
                expect.objectContaining({ id: DDSP_INSTRUMENT_CATALOG[1]?.id })
            )
        );
        expect(check_ddsp_instrument_ready).not.toHaveBeenCalledWith(expect.objectContaining({ id: instrument.id }));

        removalGate.resolve();
        await Promise.all([removal, initialization]);

        expect(modelRegistryStore.value?.ddspInstruments.find(({ id }) => id === instrument.id)).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
    });

    it('should let another instrument startup probe proceed while one instrument is exclusively locked', async () => {
        const blockedInstrument = DDSP_INSTRUMENT_CATALOG[0];
        const independentInstrument = DDSP_INSTRUMENT_CATALOG[1];
        const exclusiveGate = deferred();
        const with_ddsp_instrument_lock = create_instrument_lock();
        const exclusive = with_ddsp_instrument_lock(blockedInstrument.id, 'exclusive', () => exclusiveGate.promise);
        const check_ddsp_instrument_ready = vi.fn<CheckDdspInstrumentReady>().mockResolvedValue(false);
        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn<CheckVerifiedModel>().mockResolvedValue(false),
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            withDdspInstrumentLock: with_ddsp_instrument_lock,
        });

        const initialization = initBrowserAi();
        await vi.waitFor(() =>
            expect(check_ddsp_instrument_ready).toHaveBeenCalledWith(
                expect.objectContaining({ id: independentInstrument.id })
            )
        );
        expect(check_ddsp_instrument_ready).not.toHaveBeenCalledWith(
            expect.objectContaining({ id: blockedInstrument.id })
        );
        expect(with_ddsp_instrument_lock).toHaveBeenCalledWith(
            independentInstrument.id,
            'shared',
            expect.any(Function)
        );

        exclusiveGate.resolve();
        await Promise.all([exclusive, initialization]);
    });

    it('should fail closed to not-downloaded when startup readiness locking fails', async () => {
        const logger_mock = create_logger_mock();
        const with_ddsp_instrument_lock = vi.fn<WithDdspInstrumentLock>().mockRejectedValue(new Error('lock failed'));
        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn<CheckVerifiedModel>().mockResolvedValue(false),
            checkDdspInstrumentReady: vi.fn<CheckDdspInstrumentReady>().mockResolvedValue(true),
            withDdspInstrumentLock: with_ddsp_instrument_lock,
        });

        await expect(initBrowserAi()).resolves.toBeUndefined();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
                ...instrument,
                status: 'not-downloaded',
                downloadProgress: 0,
            }))
        );
        expect(logger_mock.warn).toHaveBeenCalledTimes(DDSP_INSTRUMENT_CATALOG.length);
    });

    it('reports Kokoro ready only after the cached artifact is verified', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(true);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('ready');
        expect(modelRegistryStore.value?.kokoroModel?.downloadProgress).toBe(1);
    });

    it('should preserve cache-probe failures as model error state', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi
            .fn<CheckVerifiedModel>()
            .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('error');
        expect(modelRegistryStore.value?.vocoder).toBeNull();
    });

    it('should record a capability detection failure as a non-fatal error and continue initializing', async () => {
        const detect_capabilities_repo = vi
            .fn<DetectCapabilitiesRepo>()
            .mockRejectedValue(new Error('WebGPU probe crashed'));
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        const logger_mock = create_logger_mock();

        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        expect(capabilityStore.value).toEqual({ phase: 'error', message: 'WebGPU probe crashed' });
        expect(logger_mock.warn).toHaveBeenCalledWith('[BrowserAi] Capability detection failed: WebGPU probe crashed');
        // Non-fatal — the rest of initialization still ran.
        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('not-downloaded');
    });

    it('should request persistent storage when the browser supports it', async () => {
        const persist = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
        Object.defineProperty(globalThis.navigator, 'storage', {
            configurable: true,
            value: { persist },
        });
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('should swallow a persistent-storage denial without failing initialization', async () => {
        const persist = vi.fn<() => Promise<boolean>>().mockRejectedValue(new DOMException('denied'));
        Object.defineProperty(globalThis.navigator, 'storage', {
            configurable: true,
            value: { persist },
        });
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        const logger_mock = create_logger_mock();

        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await expect(initBrowserAi()).resolves.toBeUndefined();

        expect(logger_mock.debug).toHaveBeenCalledWith(
            '[BrowserAi] navigator.storage.persist() not granted — non-fatal'
        );
    });

    it('should adopt the first MIDI emission as a baseline without marking anything stale', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-1': 'preview' },
        });

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        const onMidiChange = subscribe_to_midi_store.mock.calls[0]?.[0];
        if (!onMidiChange) {
            throw new Error('expected initBrowserAi to subscribe to midiStore');
        }

        onMidiChange({ notesByClipId: { 'clip-1': [] } });

        expect(renderQueueStore.value?.phraseStatusMap['clip-1']).toBe('preview');
    });

    it('should mark only rendered phrases whose note array reference changed after the baseline', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-rendered': 'final', 'clip-queued': 'queued' },
        });

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            withDdspInstrumentLock: pass_through_lock,
        });

        await initBrowserAi();

        const onMidiChange = subscribe_to_midi_store.mock.calls[0]?.[0];
        if (!onMidiChange) {
            throw new Error('expected initBrowserAi to subscribe to midiStore');
        }

        const baseline_notes: unknown[] = [];
        onMidiChange({ notesByClipId: { 'clip-rendered': baseline_notes, 'clip-queued': baseline_notes } });

        onMidiChange({ notesByClipId: { 'clip-rendered': [], 'clip-queued': [] } });

        expect(renderQueueStore.value?.phraseStatusMap['clip-rendered']).toBe('stale');
        // A 'queued' phrase has not rendered anything yet — it must not be
        // demoted to stale just because its notes changed.
        expect(renderQueueStore.value?.phraseStatusMap['clip-queued']).toBe('queued');
    });
});
