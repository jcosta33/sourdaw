import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const subscribe_to_midi_store = vi.hoisted(() => vi.fn(() => () => undefined));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        subscribe: subscribe_to_midi_store,
    },
}));

import { type CapabilityReport } from '../../models/CapabilityReport';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { capabilityStore } from '../../stores/capabilityStore';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { initBrowserAi } from '../initBrowserAi';

type DetectCapabilitiesRepo = (input?: { forceRefresh?: boolean }) => Promise<CapabilityReport>;
type CheckModelCached = (input: { family: string; modelId: string }) => Promise<boolean>;

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
    benchmarkMs: 12,
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
    });

    it('should force a capability re-probe on cold start instead of allowing a cached report', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_model_cached = vi.fn<CheckModelCached>().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkModelCached: check_model_cached,
        });

        await initBrowserAi();

        expect(detect_capabilities_repo).toHaveBeenCalledWith({ forceRefresh: true });
        expect(capabilityStore.value).toEqual({ phase: 'done', report: fresh_capability_report });
        expect(subscribe_to_midi_store).toHaveBeenCalledTimes(1);
    });

    it('should initialize DDSP instruments as unavailable while the TF.js worker is stubbed', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_model_cached = vi.fn<CheckModelCached>().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkModelCached: check_model_cached,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) => ({
                ...instrument,
                status: 'error',
                downloadProgress: 0,
            }))
        );
        expect(modelRegistryStore.value?.ddspInstruments.map((instrument) => instrument.status)).toEqual([
            'error',
            'error',
            'error',
            'error',
        ]);
        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('not-downloaded');
        expect(modelRegistryStore.value?.vocoder?.status).toBe('not-downloaded');
    });

    it('should preserve cache-probe failures as model error state', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(fresh_capability_report);
        const check_model_cached = vi
            .fn<CheckModelCached>()
            .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
            .mockResolvedValueOnce(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkModelCached: check_model_cached,
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('error');
        expect(modelRegistryStore.value?.vocoder?.status).toBe('not-downloaded');
    });
});
