/**
 * Use case: Initialize the BrowserAi module on app startup.
 *
 * Called once from bootstrap. Responsibilities:
 * 1. Detect browser platform capabilities (cold-start probe; no inference measurement)
 * 2. Populate model registry with DDSP catalog + Kokoro model entry
 * 3. Check which downloadable models are already cached in OPFS and update status
 * 4. Request persistent storage if browser AI is supported
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';

import { type DdspInstrument, type KokoroModel, type ModelDownloadStatus } from '../models/BrowserModel';
import {
    DDSP_INSTRUMENT_CATALOG,
    KOKORO_VOICE_CATALOG,
    KOKORO_MODEL_URL,
    KOKORO_MODEL_SIZE_BYTES,
} from '../models/DdspInstrumentCatalog';
import { detectCapabilities as detectCapabilitiesRepo } from '../repositories/capabilityDetector';
import { checkModelCached } from '../repositories/checkModelCached';
import { setCapabilityReport, setCapabilityError } from '../stores/capabilityStore';
import { modelRegistryStore } from '../stores/modelRegistryStore';
import { renderQueueStore, markPhraseStale } from '../stores/renderQueueStore';

/** Stored so it can be cancelled on re-initialization (e.g. HMR) or in tests. */
let midiStaleSubscription: (() => void) | undefined;

export const KOKORO_MODEL_ENTRY: KokoroModel = {
    id: 'kokoro-82m-q8',
    name: 'Kokoro TTS (q8f16)',
    family: 'kokoro',
    sizeBytes: KOKORO_MODEL_SIZE_BYTES,
    url: KOKORO_MODEL_URL,
    license: 'Apache-2.0',
    attribution: 'Kokoro by hexgrad — Apache 2.0',
    nativeSampleRate: 24000,
    status: 'not-downloaded',
    downloadProgress: 0,
    quantization: 'q8',
};

export const initBrowserAi = inject({ logger, detectCapabilitiesRepo, checkModelCached })(
    ({ logger, detectCapabilitiesRepo, checkModelCached }) =>
        async function initBrowserAi(): Promise<void> {
            logger.info('[BrowserAi] Initializing…');

            // ── 1. Detect capabilities ──────────────────────────────────────
            // Platform facts only. `measureInference` is deliberately off: the
            // throughput probe renders a full Kokoro phrase, which is not a cost
            // app startup may pay. The tier therefore reads `not-measured` until
            // the AI settings panel runs the measurement.
            try {
                const report = await detectCapabilitiesRepo({ forceRefresh: true, measureInference: false });
                setCapabilityReport(report);
                logger.info(`[BrowserAi] Capability: ${report.capability} / ${report.webGpuTier}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setCapabilityError(message);
                logger.warn(`[BrowserAi] Capability detection failed: ${message}`);
                // Non-fatal — continue initialization
            }

            // ── 2. Request persistent storage (prevents OPFS eviction) ────
            if (typeof navigator !== 'undefined' && 'storage' in navigator && 'persist' in navigator.storage) {
                try {
                    await navigator.storage.persist();
                } catch {
                    logger.debug('[BrowserAi] navigator.storage.persist() not granted — non-fatal');
                }
            }

            // ── 3. Build DDSP instrument entries from catalog ──────────────
            // DDSP browser rendering is unavailable in this build because the TF.js
            // worker is a stub; keep the catalog visible without advertising readiness.
            const ddspInstruments: DdspInstrument[] = DDSP_INSTRUMENT_CATALOG.map((cat) => ({
                ...cat,
                status: 'error' as const,
                downloadProgress: 0,
            }));

            // ── 3. Check Kokoro model cache status ─────────────────────────
            let kokoroStatus: ModelDownloadStatus;
            try {
                const cached = await checkModelCached({ family: 'kokoro', modelId: KOKORO_MODEL_ENTRY.id });
                kokoroStatus = cached ? 'ready' : 'not-downloaded';
            } catch (error) {
                kokoroStatus = 'error';
                logger.warn(`[BrowserAi] Kokoro cache probe failed: ${String(error)}`);
            }
            const kokoroModel: KokoroModel = {
                ...KOKORO_MODEL_ENTRY,
                status: kokoroStatus,
                downloadProgress: kokoroStatus === 'ready' ? 1 : 0,
            };

            // ── 4. Populate model registry store ───────────────────────────
            modelRegistryStore.set({
                ddspInstruments,
                kokoroModel,
                diffSingerVoicebanks: [],
                vocoder: null,
                storageUsedBytes: 0,
            });

            logger.info(
                `[BrowserAi] Registry initialized: ${String(ddspInstruments.length)} DDSP instruments, Kokoro: ${kokoroModel.status}`
            );

            // ── 5. Subscribe to midiStore — mark rendered phrases stale on edit ──
            // The unsubscribe function is stored at module scope so it is not garbage-collected
            // and can be called if the module is ever torn down (e.g. in tests or HMR).
            midiStaleSubscription?.();

            // Do NOT snapshot the baseline at subscribe time: midiStore may not be
            // hydrated yet (Automerge loads asynchronously), so midiStore.value is the
            // empty seed `{}` until the first emission lands. If MIDI hydrates *after*
            // BrowserAi, diffing a populated map against that empty baseline would mark
            // every already-rendered phrase stale. Instead, adopt the first emission as
            // the baseline and only compare from the second emission onward.
            let prevNotesByClipId: MidiStoreState['notesByClipId'] | undefined;
            midiStaleSubscription = midiStore.subscribe((next) => {
                const nextNotesByClipId = next?.notesByClipId ?? {};

                // First emission (incl. the hydration emission): establish the baseline
                // without flagging anything stale.
                if (prevNotesByClipId === undefined) {
                    prevNotesByClipId = nextNotesByClipId;
                    return;
                }

                const queueState = renderQueueStore.value;
                if (!queueState) {
                    prevNotesByClipId = nextNotesByClipId;
                    return;
                }

                const renderedStatuses = new Set(['preview', 'final', 'stale']);
                for (const clipId of Object.keys(nextNotesByClipId)) {
                    const currentStatus = queueState.phraseStatusMap[clipId];
                    if (!currentStatus || !renderedStatuses.has(currentStatus)) {
                        continue;
                    }
                    // Compare by reference — note arrays are replaced on every edit
                    if (nextNotesByClipId[clipId] !== prevNotesByClipId[clipId]) {
                        markPhraseStale(clipId);
                        logger.debug(`[BrowserAi] Phrase ${clipId} marked stale after MIDI edit`);
                    }
                }
                prevNotesByClipId = nextNotesByClipId;
            });
        }
);

/** Re-export catalogs and shared types for components that render instrument / voice selectors */
export { KOKORO_VOICE_CATALOG, DDSP_INSTRUMENT_CATALOG };
