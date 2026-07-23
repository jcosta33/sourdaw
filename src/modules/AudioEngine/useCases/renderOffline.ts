import { sidechainStore } from '#/modules/Routing/stores';

import { createExportError } from '../errors/ExportError';
import { prepareOfflineSidechainCompressor } from '../repositories/devices/dynamics/prepareOfflineSidechainCompressor';

import { type DeviceNodeEntry } from './buildDeviceChain';
import { acquireRenderLock } from './offlineRender/acquireRenderLock';
import { checkCancel } from './offlineRender/checkCancel';
import { connectOfflineSidechainRoutes } from './offlineRender/connectOfflineSidechainRoutes';
import { connectOfflineToasterPadRoutes } from './offlineRender/connectOfflineToasterPadRoutes';
import {
    MAX_OFFLINE_FRAMES,
    MIN_RENDER_TIMEOUT_MS,
    PROGRESS_EASE_COEFF,
    RENDER_TIMEOUT_MULTIPLIER,
} from './offlineRender/constants';
import { createOfflineBusStrip } from './offlineRender/createOfflineBusStrip';
import { createOfflineTrackStrip } from './offlineRender/createOfflineTrackStrip';
import { renderWithTimeout } from './offlineRender/renderWithTimeout';
import { resetCancelFlag } from './offlineRender/resetCancelFlag';
import { resolveRenderContext } from './offlineRender/resolveRenderContext';
import { schedulePendingSuspends } from './offlineRender/schedulePendingSuspends';
import { scheduleTrackClips } from './offlineRender/scheduleTrackClips';
import { shouldCreateOfflineStrip } from './offlineRender/shouldCreateOfflineStrip';
import {
    type OfflineBusStrip,
    type OfflineRenderOptions,
    type OfflineTrackStrip,
    type PendingWorkletEvent,
} from './offlineRender/types';
import { yieldToMain } from './offlineRender/yieldToMain';

type RenderOfflineFn = {
    (opts: OfflineRenderOptions): Promise<AudioBuffer>;
    (durationBeats: number, sampleRate?: number): Promise<AudioBuffer>;
};

export const renderOffline: RenderOfflineFn = async function renderOffline(
    optsOrBeats: OfflineRenderOptions | number,
    maybeSampleRate?: number
): Promise<AudioBuffer> {
    const releaseLock = acquireRenderLock();

    try {
        // Reset cancel token inside the try so it is never reset when acquireRenderLock throws.
        resetCancelFlag();

        const durationBeats = typeof optsOrBeats === 'number' ? optsOrBeats : optsOrBeats.durationBeats;
        const sampleRate =
            typeof optsOrBeats === 'number' ? (maybeSampleRate ?? 44100) : (optsOrBeats.sampleRate ?? 44100);
        const onProgress = typeof optsOrBeats === 'object' ? optsOrBeats.onProgress : undefined;
        const onWarning = typeof optsOrBeats === 'object' ? optsOrBeats.onWarning : undefined;
        const startBeat = typeof optsOrBeats === 'object' ? (optsOrBeats.startBeat ?? 0) : 0;
        const tailSeconds = typeof optsOrBeats === 'object' ? (optsOrBeats.tailSeconds ?? 0) : 0;

        if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
            throw createExportError(
                `Invalid export duration: ${durationBeats} beats. Project may have no clips or corrupt clip data.`
            );
        }

        const {
            tracks,
            midi,
            transport,
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
        if (!projectMidiEvents || !selectMidiEventProbability || !projectPpqEndpoints) {
            throw new Error('Offline musical projection is not configured');
        }

        // Clamp frame count to browser-safe maximum to avoid context creation error.
        const frameCount = Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES);
        const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
        const masterGain = offlineCtx.createGain();
        // Use the project's master gain level (stored as 0-100) rather than a hardcoded value.
        masterGain.gain.value = Math.max(0, Math.min(1, (transport?.masterGain ?? 80) / 100));
        masterGain.connect(offlineCtx.destination);

        // Exclude muted, disabled, and structural (folder) tracks from the render.
        // We MUST include folder tracks if they contain a Toaster device, because
        // child tracks send MIDI to the parent Toaster device to generate audio.
        const allRenderableTracks =
            tracks && midi ? tracks.tracks.filter((track) => !track.disabled && shouldCreateOfflineStrip(track)) : [];
        const sourceTracks = allRenderableTracks.filter((track) => !track.muted);
        const sidechainRoutes = sidechainStore.value?.routes ?? [];
        const hasSidechainCompressor = allRenderableTracks.some((track) =>
            track.devices.some((device) => !device.bypassed && device.type === 'builtin-sidechain-compressor')
        );
        if (hasSidechainCompressor) {
            await prepareOfflineSidechainCompressor(offlineCtx);
        }
        let scheduled = 0;
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        // Build the same strip topology the live engine uses:
        // Track input -> devices -> pre-fader tap -> fader -> mute -> pan -> output routing.
        // Sends tap either pre-fader or post-pan. Return buses receive audio at
        // their owning track input so the persisted device chain and mixer state
        // are applied before the bus output reaches master.
        const trackStripsById = new Map<string, OfflineTrackStrip>();
        const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
        const busStripsById = new Map<string, OfflineBusStrip>();

        for (const track of allRenderableTracks) {
            checkCancel();
            const strip = await createOfflineTrackStrip(offlineCtx, track);
            trackStripsById.set(track.id, strip);
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
            if (track.kind === 'bus') {
                busStripsById.set(track.id, createOfflineBusStrip(strip));
            }
        }

        connectOfflineToasterPadRoutes({ tracks: tracks?.tracks ?? [], trackStripsById, deviceEntriesByTrack });
        connectOfflineSidechainRoutes({ offlineCtx, routes: sidechainRoutes, trackStripsById, deviceEntriesByTrack });

        for (const track of allRenderableTracks) {
            const strip = trackStripsById.get(track.id);
            if (!strip) {
                continue;
            }

            if (track.outputId === 'hw_out' || !track.outputId) {
                strip.outputNode.connect(masterGain);
            } else {
                const busStrip = busStripsById.get(track.outputId);
                const targetTrackStrip = trackStripsById.get(track.outputId);
                if (busStrip) {
                    strip.outputNode.connect(busStrip.gainNode);
                } else if (targetTrackStrip) {
                    strip.outputNode.connect(targetTrackStrip.inputNode);
                } else {
                    strip.outputNode.connect(masterGain);
                }
            }

            for (const send of track.sends) {
                const busStrip = busStripsById.get(send.busId);
                if (!busStrip) {
                    continue;
                }
                const sendGain = offlineCtx.createGain();
                sendGain.gain.value = Math.max(0, Math.min(1, send.level));
                const tapNode = send.preFader ? strip.preFaderTap : strip.outputNode;
                tapNode.connect(sendGain);
                sendGain.connect(busStrip.gainNode);
            }
        }

        // Schedule only audible source tracks, but keep the full routing graph alive so
        // buses, targets, and the master strip behave like live playback.
        for (const track of sourceTracks) {
            checkCancel();

            const strip = trackStripsById.get(track.id);
            if (!strip) {
                continue;
            }

            await scheduleTrackClips({
                offlineCtx,
                track,
                midi: midi!,
                trackInputNode: strip.inputNode,
                trackGainNode: strip.faderNode,
                trackPanNode: strip.panNode,
                destination: masterGain,
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
                // Keep canonical project order for Toaster pad indexes. The
                // scheduler skips inaudible children only after indexing.
                allTracks: tracks?.tracks ?? [],
                deviceEntriesByTrack,
                regionStartBeat: startBeat,
            });

            scheduled++;
            onProgress?.((scheduled / Math.max(1, sourceTracks.length)) * 0.5); // scheduling = 0-50%
        }

        // Register all worklet note suspend points ONCE after all tracks are scheduled.
        // This prevents duplicate suspend() calls when multiple tracks target the same frame.
        schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

        checkCancel();

        // Yield so the UI can paint the scheduling-complete mark before startRendering() blocks.
        await yieldToMain();

        // OfflineAudioContext.startRendering() emits no progress events — animate toward 97%
        // using an easing approach. eligible.length > 0 means scheduling reached 50%, so start
        // the simulation from there; otherwise start from 0.
        const schedulingFrac = sourceTracks.length > 0 ? 0.5 : 0;
        let simFrac = schedulingFrac;
        const renderTimer = onProgress
            ? setInterval(() => {
                  simFrac += (0.97 - simFrac) * PROGRESS_EASE_COEFF;
                  onProgress(simFrac);
              }, 100)
            : null;

        const renderTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
        const buffer = await renderWithTimeout(offlineCtx, renderTimeoutMs).finally(() => {
            if (renderTimer !== null) {
                clearInterval(renderTimer);
            }
        });

        onProgress?.(1);
        return buffer;
    } finally {
        releaseLock();
    }
};
