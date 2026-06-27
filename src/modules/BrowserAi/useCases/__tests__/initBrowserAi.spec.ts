import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type CapabilityReport } from '../../models/CapabilityReport';

const subscribe_to_midi_store = vi.hoisted(() => vi.fn(() => () => undefined));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        subscribe: subscribe_to_midi_store,
    },
}));

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
});
