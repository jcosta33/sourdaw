import { shouldCreateLiveTrackStrip } from '#/modules/Arrangement/stores';

import { createExportError } from '../errors/ExportError';

import { type DeviceNodeEntry } from './buildDeviceChain';
import { acquireRenderLock } from './offlineRender/acquireRenderLock';
import { checkCancel } from './offlineRender/checkCancel';
import { connectOfflineToasterPadRoutes } from './offlineRender/connectOfflineToasterPadRoutes';
import {
    MAX_OFFLINE_FRAMES,
    MIN_RENDER_TIMEOUT_MS,
    PROGRESS_EASE_COEFF,
    RENDER_TIMEOUT_MULTIPLIER,
} from './offlineRender/constants';
import { createOfflineTrackStrip } from './offlineRender/createOfflineTrackStrip';
import { isCancelRequested } from './offlineRender/isCancelRequested';
import { renderWithTimeout } from './offlineRender/renderWithTimeout';
import { resetCancelFlag } from './offlineRender/resetCancelFlag';
import { resolveRenderContext } from './offlineRender/resolveRenderContext';
import { schedulePendingSuspends } from './offlineRender/schedulePendingSuspends';
import { scheduleTrackClips } from './offlineRender/scheduleTrackClips';
import { type OfflineRenderOptions, type OfflineTrackStrip, type PendingWorkletEvent } from './offlineRender/types';
import { yieldToMain } from './offlineRender/yieldToMain';
import { resolveToasterPadBinding } from './resolveToasterPadBinding';

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
        const startBeat = typeof optsOrBeats === 'object' ? (optsOrBeats.startBeat ?? 0) : 0;
        const tailSeconds = typeof optsOrBeats === 'object' ? (optsOrBeats.tailSeconds ?? 0) : 0;

        if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
            throw createExportError(`Invalid export duration: ${durationBeats} beats.`);
        }

        const {
            tracks,
            midi,
            defaultTempo,
            changes,
            durationSeconds,
            projectMidiEvents,
            selectMidiEventProbability,
            projectPpqEndpoints,
            processYeastMidi,
        } = resolveRenderContext({
            durationBeats,
            startBeat,
            tailSeconds,
            sampleRate,
        });
        const stems = new Map<string, AudioBuffer>();

        if (!tracks || !midi) {
            onProgress?.(1);
            return stems;
        }
        if (!projectMidiEvents || !selectMidiEventProbability || !projectPpqEndpoints) {
            throw new Error('Offline musical projection is not configured');
        }

        const toasterParentIds = new Set(
            tracks.tracks
                .filter(
                    (track) =>
                        !track.disabled &&
                        track.kind !== 'master' &&
                        shouldCreateLiveTrackStrip(track) &&
                        track.devices.some((device) => device.type === 'toaster')
                )
                .map((track) => track.id)
        );
        const groupedPadIds = new Set(
            tracks.tracks.flatMap((track) => {
                const binding = resolveToasterPadBinding(tracks.tracks, track.id);
                return binding && toasterParentIds.has(binding.toasterParentTrackId) ? [track.id] : [];
            })
        );

        // Toaster owns its children's sound generation, so export one grouped parent stem.
        // Other muted tracks remain eligible (users may want silent-in-mixdown stems).
        const eligible = tracks.tracks.filter((time) => {
            if (time.disabled) {
                return false;
            }
            if (groupedPadIds.has(time.id)) {
                return false;
            }
            return time.kind !== 'master' && shouldCreateLiveTrackStrip(time);
        });
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
            const groupedPads = toasterParentIds.has(track.id)
                ? tracks.tracks.filter(
                      (candidate) =>
                          groupedPadIds.has(candidate.id) &&
                          !candidate.disabled &&
                          shouldCreateLiveTrackStrip(candidate)
                  )
                : [];
            const groupedTracks = [track, ...groupedPads];
            const trackStripsById = new Map<string, OfflineTrackStrip>();
            const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
            for (const groupedTrack of groupedTracks) {
                const groupedStrip = await createOfflineTrackStrip(offlineCtx, groupedTrack);
                trackStripsById.set(groupedTrack.id, groupedStrip);
                deviceEntriesByTrack.set(groupedTrack.id, groupedStrip.deviceEntries);
            }
            const strip = trackStripsById.get(track.id)!;
            if (groupedPads.length > 0) {
                connectOfflineToasterPadRoutes({
                    tracks: tracks.tracks,
                    trackStripsById,
                    deviceEntriesByTrack,
                });
                for (const pad of groupedPads) {
                    trackStripsById.get(pad.id)?.outputNode.connect(strip.inputNode);
                }
            }
            strip.outputNode.connect(offlineCtx.destination);

            for (const groupedTrack of groupedTracks) {
                const groupedStrip = trackStripsById.get(groupedTrack.id)!;
                await scheduleTrackClips({
                    offlineCtx,
                    track: groupedTrack === track ? track : { ...groupedTrack, clips: [] },
                    midi,
                    trackInputNode: groupedStrip.inputNode,
                    trackGainNode: groupedStrip.faderNode,
                    trackPanNode: groupedStrip.panNode,
                    destination: offlineCtx.destination,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    projections: {
                        projectMidiEvents,
                        projectPpqEndpoints,
                        processYeastMidi,
                        selectMidiEventProbability,
                    },
                    onWarning,
                    pendingWorkletEvents,
                    allTracks: groupedPads.length > 0 ? tracks.tracks : [track],
                    deviceEntriesByTrack,
                    regionStartBeat: startBeat,
                });
            }

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
            function next(): void {
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
                                // eslint-disable-next-line promise/no-callback-in-promise -- `next` is an internal concurrent-pool scheduler, not a Node-style callback; it re-enters the loop to start the next pending task
                                next();
                            }
                            return null;
                        })
                        .catch(reject);
                }
                if (taskIndex >= tasks.length && activeTasks === 0) {
                    resolve();
                }
            }
            next();
        });

        return stems;
    } finally {
        releaseLock();
    }
};
