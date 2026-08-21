import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

vi.mock('#/infra/release/modelReleaseAdmission', () => ({
    MODEL_RELEASE_ADMISSION: {
        basicPitch: true,
        ddsp: true,
        kokoro: true,
        rave: false,
        stemSeparation: false,
        webLlm: false,
        whisper: true,
    },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { subscribe: vi.fn(() => () => undefined) },
}));

import { type CapabilityReport } from '../../models/CapabilityReport';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { capabilityStore } from '../../stores/capabilityStore';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { initBrowserAi } from '../initBrowserAi';

const capabilityReport: CapabilityReport = {
    capability: 'supported',
    webGpu: { status: 'supported' },
    webGpuTier: 'webgpu-fast',
    crossOriginIsolated: true,
    workerAvailable: true,
    opfsAvailable: true,
    inference: { status: 'not-measured', reason: 'not-requested' },
    detectedAt: 1_803_556_800_000,
};

describe('initBrowserAi DDSP readiness', () => {
    beforeEach(() => {
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

    it('records ready only after a shared lock observes the complete verified artifact generation', async () => {
        const checkDdspInstrumentReady = vi.fn(async ({ id }: { id: string }) => id === 'ddsp-violin');
        const withDdspInstrumentLock = vi.fn(
            (_id: string, _mode: 'exclusive' | 'shared', operation: () => Promise<boolean>) => operation()
        );
        injectDependencies(initBrowserAi, {
            logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(capabilityReport),
            checkVerifiedModel: vi.fn().mockResolvedValue(false),
            checkDdspInstrumentReady,
            withDdspInstrumentLock,
        });

        await initBrowserAi();

        expect(checkDdspInstrumentReady).toHaveBeenCalledTimes(DDSP_INSTRUMENT_CATALOG.length);
        expect(checkDdspInstrumentReady).toHaveBeenCalledWith({
            id: 'ddsp-violin',
            version: DDSP_INSTRUMENT_CATALOG[0]?.artifactVersion,
            artifacts: DDSP_INSTRUMENT_CATALOG[0]?.artifacts,
        });
        expect(withDdspInstrumentLock).toHaveBeenCalledWith('ddsp-violin', 'shared', expect.any(Function));
        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) =>
                expect.objectContaining({
                    id: instrument.id,
                    status: instrument.id === 'ddsp-violin' ? 'ready' : 'not-downloaded',
                })
            )
        );
    });

    it('fails closed to not-downloaded when a readiness lock cannot be acquired', async () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
        injectDependencies(initBrowserAi, {
            logger,
            detectCapabilitiesRepo: vi.fn().mockResolvedValue(capabilityReport),
            checkVerifiedModel: vi.fn().mockResolvedValue(false),
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(true),
            withDdspInstrumentLock: vi.fn().mockRejectedValue(new Error('lock failed')),
        });

        await initBrowserAi();

        expect(modelRegistryStore.value?.ddspInstruments).toEqual(
            DDSP_INSTRUMENT_CATALOG.map((instrument) =>
                expect.objectContaining({ id: instrument.id, status: 'not-downloaded', downloadProgress: 0 })
            )
        );
        expect(logger.warn).toHaveBeenCalledTimes(DDSP_INSTRUMENT_CATALOG.length);
    });
});
