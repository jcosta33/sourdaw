import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const subscribe_to_midi_store = vi.hoisted(() => vi.fn(() => () => undefined));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        subscribe: subscribe_to_midi_store,
    },
}));

import { type CapabilityReport } from '../../models/CapabilityReport';
import { KOKORO_MODEL_ARTIFACT } from '../../models/KokoroArtifactManifest';
import { capabilityStore } from '../../stores/capabilityStore';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { initBrowserAi } from '../initBrowserAi';

type DetectCapabilitiesRepo = (input?: {
    forceRefresh?: boolean;
    measureInference?: boolean;
}) => Promise<CapabilityReport>;
type CheckModelCached = (input: { family: string; modelId: string }) => Promise<boolean>;

function create_logger_mock(): { info: (m: string) => void; warn: (m: string) => void; debug: (m: string) => void } {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };
}

const supported_report: CapabilityReport = {
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

// A later cold start on a regressed WebView2/WebGPU runtime: the same machine now
// probes as unsupported. Cold-start detection must surface this, not reuse a stale
// first-launch report.
const regressed_report: CapabilityReport = {
    capability: 'unsupported-browser',
    webGpuTier: 'unavailable',
    sharedArrayBuffer: false,
    opfsAvailable: true,
    chromeVersion: 133,
    inference: { status: 'not-measured', reason: 'no-webgpu' },
    detectedAt: 1_803_643_200_000,
};

describe('BrowserAi capabilityColdStart', () => {
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

    it('forces a fresh capability probe on cold start rather than accepting a cached report', async () => {
        const detect_capabilities_repo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(supported_report);
        const check_model_cached = vi.fn<CheckModelCached>().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkModelCached: check_model_cached,
        });

        await initBrowserAi();

        expect(detect_capabilities_repo).toHaveBeenCalledWith({ forceRefresh: true, measureInference: false });
        expect(capabilityStore.value).toEqual({ phase: 'done', report: supported_report });
    });

    it('re-detects on every cold start so a later WebGPU regression replaces the earlier report', async () => {
        const detect_capabilities_repo = vi
            .fn<DetectCapabilitiesRepo>()
            .mockResolvedValueOnce(supported_report)
            .mockResolvedValueOnce(regressed_report);
        const check_model_cached = vi.fn<CheckModelCached>().mockResolvedValue(false);

        injectDependencies(initBrowserAi, {
            logger: create_logger_mock(),
            detectCapabilitiesRepo: detect_capabilities_repo,
            checkModelCached: check_model_cached,
        });

        // First cold start: healthy runtime.
        await initBrowserAi();
        expect(capabilityStore.value).toEqual({ phase: 'done', report: supported_report });

        // Second cold start on a regressed runtime: detection runs again (forceRefresh),
        // and the regressed report replaces the earlier one instead of being skipped.
        await initBrowserAi();

        expect(detect_capabilities_repo).toHaveBeenCalledTimes(2);
        expect(detect_capabilities_repo).toHaveBeenNthCalledWith(1, { forceRefresh: true, measureInference: false });
        expect(detect_capabilities_repo).toHaveBeenNthCalledWith(2, { forceRefresh: true, measureInference: false });
        expect(capabilityStore.value).toEqual({ phase: 'done', report: regressed_report });
    });
});
