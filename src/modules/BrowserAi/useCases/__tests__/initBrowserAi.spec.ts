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
type ReadVerifiedModel = (input: {
    family: string;
    modelId: string;
    sha256: string;
    sizeBytes: number;
}) => Promise<ArrayBuffer | null>;

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

const fresh_capability_report: CapabilityReport = {
    capability: 'supported',
    webGpuTier: 'webgpu-fast',
    sharedArrayBuffer: true,
    opfsAvailable: true,
    chromeVersion: 133,
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
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
        });

        await initBrowserAi();

        // App startup takes the platform facts only. The throughput probe renders a
        // full Kokoro phrase; paying that on every boot is not acceptable, so the
        // flag must stay off here.
        expect(detect_capabilities_repo).toHaveBeenCalledWith({ forceRefresh: true, measureInference: false });
        expect(capabilityStore.value).toEqual({ phase: 'done', report: fresh_capability_report });
        expect(subscribe_to_midi_store).toHaveBeenCalledTimes(1);
    });

    it('should keep withheld DDSP checkpoints out of the runtime registry', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual([]);
        expect(DDSP_INSTRUMENT_CATALOG.every((instrument) => instrument.license === 'Unverified')).toBe(true);
        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('not-downloaded');
        expect(read_verified_model).toHaveBeenCalledWith({
            family: 'kokoro',
            modelId: KOKORO_MODEL_ARTIFACT.id,
            sha256: KOKORO_MODEL_ARTIFACT.sha256,
            sizeBytes: KOKORO_MODEL_ARTIFACT.sizeBytes,
        });
        expect(modelRegistryStore.value?.vocoder).toBeNull();
    });

    it('reports Kokoro ready only after the cached artifact is verified', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(new ArrayBuffer(8));

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('ready');
        expect(modelRegistryStore.value?.kokoroModel?.downloadProgress).toBe(1);
    });

    it('should preserve cache-probe failures as model error state', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const read_verified_model = vi
            .fn<ReadVerifiedModel>()
            .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('error');
        expect(modelRegistryStore.value?.vocoder).toBeNull();
    });

    it('should record a capability detection failure as a non-fatal error and continue initializing', async () => {
        const detect_capabilities_repo = vi
            .fn<DetectCapabilitiesRepo>()
            .mockRejectedValue(new Error('WebGPU probe crashed'));
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);
        const logger_mock = create_logger_mock();

        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
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
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
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
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);
        const logger_mock = create_logger_mock();

        injectDependencies(initBrowserAi, {
            logger: logger_mock,
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
        });

        await expect(initBrowserAi()).resolves.toBeUndefined();

        expect(logger_mock.debug).toHaveBeenCalledWith(
            '[BrowserAi] navigator.storage.persist() not granted — non-fatal'
        );
    });

    it('should adopt the first MIDI emission as a baseline without marking anything stale', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-1': 'preview' },
        });

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
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
        const read_verified_model = vi.fn<ReadVerifiedModel>().mockResolvedValue(null);
        renderQueueStore.set({
            entries: [],
            cachedPhraseIds: [],
            phraseStatusMap: { 'clip-rendered': 'final', 'clip-queued': 'queued' },
        });

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            readVerifiedModel: read_verified_model,
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
