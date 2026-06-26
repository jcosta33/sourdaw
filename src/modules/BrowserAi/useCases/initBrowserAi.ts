/**
 * Use case: Initialize the BrowserAi module on app startup.
 *
 * Called once from bootstrap. Responsibilities:
 * 1. Detect browser capabilities (with localStorage cache)
 * 2. Populate model registry with DDSP catalog + Kokoro model entry
 * 3. Check which models are already cached in OPFS and update status
 * 4. Request persistent storage if browser AI is supported
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';

import { type DdspInstrument, type KokoroModel, type VocoderModel } from '../models/BrowserModel';
import {
    DDSP_INSTRUMENT_CATALOG,
    KOKORO_VOICE_CATALOG,
    NSF_HIFIGAN_URL,
    NSF_HIFIGAN_SIZE_BYTES,
    KOKORO_MODEL_URL,
    KOKORO_MODEL_SIZE_BYTES,
} from '../models/ddspInstrumentCatalog';
import { detectCapabilities as detectCapabilitiesRepo } from '../repositories/capabilityDetector';
import { checkModelCached } from '../repositories/storageManager';
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

export const NSF_HIFIGAN_VOCODER: VocoderModel = {
    id: 'nsf-hifigan-44k',
    name: 'NSF-HiFiGAN Vocoder',
    family: 'diffsinger/vocoder',
    sizeBytes: NSF_HIFIGAN_SIZE_BYTES,
    url: NSF_HIFIGAN_URL,
    license: 'CC-BY-NC-SA-4.0',
    attribution: 'NSF-HiFiGAN vocoder by openvpi — CC-BY-NC-SA 4.0 (non-commercial)',
    nativeSampleRate: 44100,
    status: 'not-downloaded',
    downloadProgress: 0,
};

export const initBrowserAi = inject({ logger, detectCapabilitiesRepo, checkModelCached })(
    ({ logger, detectCapabilitiesRepo, checkModelCached }) =>
        async function initBrowserAi(): Promise<void> {
            logger.info('[BrowserAi] Initializing…');

            // ── 1. Detect capabilities ──────────────────────────────────────
            try {
                const report = await detectCapabilitiesRepo();
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
            // DDSP models are TF.js GraphModels loaded from CDN URL — no OPFS storage.
            // TF.js caches them via IndexedDB. All instruments are always available.
            const ddspInstruments: DdspInstrument[] = DDSP_INSTRUMENT_CATALOG.map((cat) => ({
                ...cat,
                status: 'ready' as const,
                downloadProgress: 1,
            }));

            // ── 3. Check Kokoro model cache status ─────────────────────────
            const kokoroCached = await checkModelCached({ family: 'kokoro', modelId: KOKORO_MODEL_ENTRY.id }).catch(
                () => false
            );
            const kokoroModel: KokoroModel = {
                ...KOKORO_MODEL_ENTRY,
                status: kokoroCached ? 'ready' : 'not-downloaded',
                downloadProgress: kokoroCached ? 1 : 0,
            };

            // ── 4. Check vocoder cache status ──────────────────────────────
            const vocoderCached = await checkModelCached({
                family: 'diffsinger/vocoder',
                modelId: NSF_HIFIGAN_VOCODER.id,
            }).catch(() => false);
            const vocoder: VocoderModel = {
                ...NSF_HIFIGAN_VOCODER,
                status: vocoderCached ? 'ready' : 'not-downloaded',
                downloadProgress: vocoderCached ? 1 : 0,
            };

            // ── 5. Populate model registry store ───────────────────────────
            modelRegistryStore.set({
                ddspInstruments,
                kokoroModel,
                diffSingerVoicebanks: [],
                vocoder,
                storageUsedBytes: 0,
            });

            logger.info(
                `[BrowserAi] Registry initialized: ${String(ddspInstruments.length)} DDSP instruments, Kokoro: ${kokoroModel.status}`
            );

            // ── 6. Subscribe to midiStore — mark rendered phrases stale on edit ──
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
export type { RenderQuality } from '../models/RenderProgress';
