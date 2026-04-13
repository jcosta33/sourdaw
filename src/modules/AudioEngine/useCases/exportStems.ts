import { createExportError } from '../errors/ExportError';
import { type DeviceNodeEntry } from './buildDeviceChain';
import {
    MAX_OFFLINE_FRAMES,
    MIN_RENDER_TIMEOUT_MS,
    PROGRESS_EASE_COEFF,
    RENDER_TIMEOUT_MULTIPLIER,
} from './offlineRender/constants';
import { createOfflineTrackStrip } from './offlineRender/createOfflineTrackStrip';
import {
    acquireRenderLock,
    checkCancel,
    isCancelRequested,
    resetCancelFlag,
} from './offlineRender/exportCancellation';
import { renderWithTimeout } from './offlineRender/renderWithTimeout';
import { resolveRenderContext } from './offlineRender/resolveRenderContext';
import { schedulePendingSuspends } from './offlineRender/schedulePendingSuspends';
import { scheduleTrackClips } from './offlineRender/scheduleTrackClips';
import { type OfflineRenderOptions, type PendingWorkletEvent } from './offlineRender/types';
import { yieldToMain } from './offlineRender/yieldToMain';

type ExportStemsFn = {
    (opts: OfflineRenderOptions): Promise<Map<string, AudioBuffer>>;
    (durationBeats: number, sampleRate?: number): Promise<Map<string, AudioBuffer>>;
};

export const exportStems: ExportStemsFn = async function exportStems(
    optsOrBeats: OfflineRenderOptions | number,
    maybeSampleRate?: number
): Promise<Map<string, AudioBuffer>> {
    const releaseLock = acquireRenderLock();

    try {
        resetCancelFlag();

        const durationBeats = typeof optsOrBeats === 'number' ? optsOrBeats : optsOrBeats.durationBeats;
        const sampleRate =
            typeof optsOrBeats === 'number' ? (maybeSampleRate ?? 44100) : (optsOrBeats.sampleRate ?? 44100);
        const onProgress = typeof optsOrBeats === 'object' ? optsOrBeats.onProgress : undefined;
        const onWarning = typeof optsOrBeats === 'object' ? optsOrBeats.onWarning : undefined;

        if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
            throw createExportError(`Invalid export duration: ${durationBeats} beats.`);
        }

        const { tracks, midi, defaultTempo, changes, durationSeconds } = resolveRenderContext(durationBeats);
        const stems = new Map<string, AudioBuffer>();

        if (!tracks || !midi) {
            onProgress?.(1);
            return stems;
        }

        // Exclude disabled and structural tracks (unless they host a Toaster); muted tracks are included as stems
        // (users may want silent-in-mixdown stems for later use in a DAW).
        const eligible = tracks.tracks.filter(
            (t) =>
                !t.disabled &&
                t.kind !== 'master' &&
                (t.kind !== 'folder' || t.devices.some((d) => d.type === 'toaster'))
        );
        let done = 0;

        if (eligible.length === 0) {
            onProgress?.(1);
            return stems;
        }

        const frameCount = Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES);
        // Dynamically scale CPU threads based on hardware, clamped to 8 max to prevent OOM.
        const MAX_CONCURRENT_RENDERS =
            typeof navigator !== 'undefined' ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 4;

        const tasks = eligible.map((track) => async () => {
            checkCancel();

            const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
            const pendingWorkletEvents: PendingWorkletEvent[] = [];
            const strip = await createOfflineTrackStrip(offlineCtx, track);
            const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
            strip.outputNode.connect(offlineCtx.destination);

            await scheduleTrackClips(
                offlineCtx,
                track,
                midi,
                strip.inputNode,
                strip.faderNode,
                strip.panNode,
                offlineCtx.destination,
                durationSeconds,
                defaultTempo,
                changes,
                onWarning,
                pendingWorkletEvents,
                [track],
                deviceEntriesByTrack
            );

            schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

            // Emit scheduling-done progress (40% of this stem's slot) before the render blocks.
            const fractAfterSchedule = (done + 0.4) / eligible.length;
            onProgress?.(fractAfterSchedule);
            await yieldToMain();

            // Simulate progress during the black-box startRendering() call.
            let stemSim = fractAfterSchedule;
            const stemTarget = (done + 1) / eligible.length;
            const stemTimer = onProgress
                ? setInterval(() => {
                      stemSim += (stemTarget * 0.97 - stemSim) * PROGRESS_EASE_COEFF;
                      onProgress(stemSim);
                  }, 100)
                : null;

            const stemTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
            const buffer = await renderWithTimeout(offlineCtx, stemTimeoutMs).finally(() => {
                if (stemTimer !== null) {
                    clearInterval(stemTimer);
                }
            });

            stems.set(track.id, buffer);
            done++;
            onProgress?.(done / eligible.length);
        });

        // Run exports concurrently up to the thread limit.
        let activeTasks = 0;
        let taskIndex = 0;

        await new Promise<void>((resolve, reject) => {
            const next = (): void => {
                if (isCancelRequested()) {
                    reject(new Error('Export cancelled'));
                    return;
                }
                while (activeTasks < MAX_CONCURRENT_RENDERS && taskIndex < tasks.length) {
                    const task = tasks[taskIndex++];
                    activeTasks++;
                    task!()
                        .then(() => {
                            activeTasks--;
                            if (taskIndex >= tasks.length && activeTasks === 0) {
                                resolve();
                            } else {
                                next();
                            }
                        })
                        .catch(reject);
                }
                if (taskIndex >= tasks.length && activeTasks === 0) {
                    resolve();
                }
            };
            next();
        });

        return stems;
    } finally {
        releaseLock();
    }
} as ExportStemsFn;
