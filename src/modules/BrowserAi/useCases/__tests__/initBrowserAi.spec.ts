import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const subscribe_to_midi_store = vi.hoisted(() =>
    vi.fn<(callback: (next: { notesByClipId: Record<string, unknown[]> } | null) => void) => () => void>(
        () => () => undefined
    )
);

const release_gate = vi.hoisted(() => ({ ddsp: true, kokoro: true }));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: release_gate }));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        subscribe: subscribe_to_midi_store,
    },
}));

import { type CapabilityReport } from '../../models/CapabilityReport';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { KOKORO_MODEL_ARTIFACT } from '../../models/KokoroArtifactManifest';
import { type StorageStatus } from '../../models/StorageStatus';
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
type GetStorageStatus = () => Promise<StorageStatus>;

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

async function pass_through_ddsp_lock<TResult>(
    _id: string,
    _mode: 'exclusive' | 'shared',
    operation: () => Promise<TResult>
): Promise<TResult> {
    return operation();
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

const empty_storage_status: StorageStatus = {
    usedBytes: 0,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: false,
    availableBytes: null,
};

describe('initBrowserAi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        release_gate.ddsp = true;
        release_gate.kokoro = true;
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
        });

        await initBrowserAi();

        // App startup takes the platform facts only. The throughput probe renders a
        // full Kokoro phrase; paying that on every boot is not acceptable, so the
        // flag must stay off here.
        expect(detect_capabilities_repo).toHaveBeenCalledWith({ forceRefresh: true, measureInference: false });
        expect(capabilityStore.value).toEqual({ phase: 'done', report: fresh_capability_report });
        expect(subscribe_to_midi_store).toHaveBeenCalledTimes(1);
    });

    it('should admit exactly four DDSP checkpoints as not-downloaded on a fresh profile', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        const check_ddsp_instrument_ready = vi.fn().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) =>
                expect.objectContaining({ id: instrument.id, status: 'not-downloaded', downloadProgress: 0 })
            )
        );
        expect(check_ddsp_instrument_ready).toHaveBeenCalledTimes(4);
        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('not-downloaded');
        expect(check_verified_model).toHaveBeenCalledWith({
            family: 'kokoro',
            modelId: KOKORO_MODEL_ARTIFACT.id,
            sha256: KOKORO_MODEL_ARTIFACT.sha256,
            sizeBytes: KOKORO_MODEL_ARTIFACT.sizeBytes,
        });
        expect(modelRegistryStore.value?.vocoder).toBeNull();
    });

    it('keeps the DDSP registry empty without readiness probes when release admission is disabled', async () => {
        release_gate.ddsp = false;
        const check_ddsp_instrument_ready = vi.fn();
        const with_ddsp_instrument_lock = vi.fn();

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn().mockResolvedValue(false),
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: with_ddsp_instrument_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual([]);
        expect(check_ddsp_instrument_ready).not.toHaveBeenCalled();
        expect(with_ddsp_instrument_lock).not.toHaveBeenCalled();
    });

    it('should mark only shared-lock-verified DDSP generations ready at startup', async () => {
        release_gate.ddsp = true;
        const check_ddsp_instrument_ready = vi.fn(async ({ id }: { id: string }) => id === 'ddsp-violin');
        const with_ddsp_instrument_lock = vi.fn(
            (_id: string, _mode: 'exclusive' | 'shared', operation: () => Promise<boolean>) => operation()
        );
        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn().mockResolvedValue(false),
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: with_ddsp_instrument_lock,
        });

        await initBrowserAi();

        expect(check_ddsp_instrument_ready).toHaveBeenCalledTimes(DDSP_INSTRUMENT_CATALOG.length);
        expect(check_ddsp_instrument_ready).toHaveBeenCalledWith({
            id: 'ddsp-violin',
            version: DDSP_INSTRUMENT_CATALOG[0]?.artifactVersion,
            artifacts: DDSP_INSTRUMENT_CATALOG[0]?.artifacts,
        });
        expect(with_ddsp_instrument_lock).toHaveBeenCalledWith('ddsp-violin', 'shared', expect.any(Function));
        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) =>
                expect.objectContaining({
                    id: instrument.id,
                    status: instrument.id === 'ddsp-violin' ? 'ready' : 'not-downloaded',
                })
            )
        );
    });

    it('should fail closed when a startup DDSP readiness lock cannot be acquired', async () => {
        release_gate.ddsp = true;
        const logger_mock = create_logger_mock();
        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn().mockResolvedValue(false),
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(true),
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: vi.fn().mockRejectedValue(new Error('lock failed')),
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) =>
                expect.objectContaining({ id: instrument.id, status: 'not-downloaded', downloadProgress: 0 })
            )
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('ready');
        expect(modelRegistryStore.value?.kokoroModel?.downloadProgress).toBe(1);
    });

    it('restores verified cached models and actual storage usage on reload', async () => {
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(true);
        const check_ddsp_instrument_ready = vi.fn().mockResolvedValue(true);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue({
            ...empty_storage_status,
            usedBytes: 4_269_123,
        });

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: check_ddsp_instrument_ready,
            getStorageStatus: get_storage_status,
            withDdspInstrumentLock: pass_through_ddsp_lock,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((candidate) =>
                expect.objectContaining({ id: candidate.id, status: 'ready', downloadProgress: 1 })
            )
        );
        expect(modelRegistryStore.value?.kokoroModel).toMatchObject({ status: 'ready', downloadProgress: 1 });
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(4_269_123);
        expect(get_storage_status).toHaveBeenCalledOnce();
        expect(get_storage_status.mock.invocationCallOrder[0]).toBeGreaterThan(
            Math.max(
                ...check_ddsp_instrument_ready.mock.invocationCallOrder,
                ...check_verified_model.mock.invocationCallOrder
            )
        );
    });

    it('keeps verified registry state when storage usage measurement fails', async () => {
        const logger_mock = create_logger_mock();
        const get_storage_status = vi
            .fn<GetStorageStatus>()
            .mockRejectedValue(new DOMException('OPFS estimate denied', 'NotAllowedError'));

        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(fresh_capability_report),
            checkVerifiedModel: vi.fn().mockResolvedValue(true),
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(true),
            getStorageStatus: get_storage_status,
            withDdspInstrumentLock: pass_through_ddsp_lock,
        });

        await expect(initBrowserAi()).resolves.toBeUndefined();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((candidate) => expect.objectContaining({ id: candidate.id, status: 'ready' }))
        );
        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('ready');
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(0);
        expect(get_storage_status).toHaveBeenCalledOnce();
        expect(logger_mock.warn).toHaveBeenCalledWith(
            '[BrowserAi] Storage usage probe failed: NotAllowedError: OPFS estimate denied'
        );
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
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
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
        });

        await initBrowserAi();

        const onMidiChange = subscribe_to_midi_store.mock.calls[0]?.[0];
        if (!onMidiChange) {
            throw new Error('expected initBrowserAi to subscribe to midiStore');
        }

        onMidiChange({ notesByClipId: { 'clip-1': [] } });

        expect(renderQueueStore.value?.phraseStatusMap['clip-1']).toBe('preview');
    });

    it('should mark legacy and canonical DDSP rendered phrases stale when a clip note array changes after the baseline', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_verified_model = vi.fn<CheckVerifiedModel>().mockResolvedValue(false);
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: {
                'clip-rendered': 'final',
                'clip-rendered-ddsp': 'preview',
                'clip-queued': 'queued',
            },
        });

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkVerifiedModel: check_verified_model,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            getStorageStatus: vi.fn().mockResolvedValue(empty_storage_status),
            withDdspInstrumentLock: pass_through_ddsp_lock,
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
        expect(renderQueueStore.value?.phraseStatusMap['clip-rendered-ddsp']).toBe('stale');
        // A 'queued' phrase has not rendered anything yet — it must not be
        // demoted to stale just because its notes changed.
        expect(renderQueueStore.value?.phraseStatusMap['clip-queued']).toBe('queued');
    });
});
