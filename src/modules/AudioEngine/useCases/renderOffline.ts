import { deriveEffectiveAudibility } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { createExportError } from '../errors/ExportError';
import { prepareOfflineSidechainCompressor } from '../repositories/devices/dynamics/prepareOfflineSidechainCompressor';
import { connectOfflineSidechainRoutes } from '../repositories/offlineRouting/connectOfflineSidechainRoutes';

import { type DeviceNodeEntry } from './buildDeviceChain';
import { getSidechainKeyDelay } from './latencyCompensation/compensation/getSidechainKeyDelay';
import { acquireRenderLock } from './offlineRender/acquireRenderLock';
import { checkCancel } from './offlineRender/checkCancel';
import { clampRenderFrameCount } from './offlineRender/clampRenderFrameCount';
import { connectOfflineToasterPadRoutes } from './offlineRender/connectOfflineToasterPadRoutes';
import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER } from './offlineRender/constants';
import { createOfflineBusStrip } from './offlineRender/createOfflineBusStrip';
import { createOfflineTrackStrip } from './offlineRender/createOfflineTrackStrip';
import { renderInSegments } from './offlineRender/renderInSegments';
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
            projectChordPitch,
            evaluateAutomationValue,
        } = resolveRenderContext({
            durationBeats,
            startBeat,
            tailSeconds,
            sampleRate,
        });
        if (!projectMidiEvents || !selectMidiEventProbability || !projectPpqEndpoints || !projectChordPitch) {
            throw new Error('Offline musical projection is not configured');
        }

        // Clamp frame count to browser-safe maximum to avoid context creation error.
        const frameCount = clampRenderFrameCount({ durationSeconds, sampleRate, onWarning });
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
        // Effective audibility (mute ∪ solo): the offline mixdown consumes the
        // same Arrangement read model the live solo path does, so a soloed
        // session exports exactly the tracks the engineer monitors (OE-4).
        //
        // Mirror the live solo path's ambiguous-owner guard (#593): a track id
        // that appears more than once in the document has no unambiguous solo
        // owner, so — exactly as toggleTrackState/applySoloLogic does — it is
        // dropped from the strip-id set and can neither engage nor answer solo.
        const projectTracks = tracks?.tracks ?? [];
        const stripTrackIds = new Set(
            allRenderableTracks
                .filter((track) => projectTracks.filter((candidate) => candidate.id === track.id).length === 1)
                .map((track) => track.id)
        );
        const { audibleByTrackId, soloGatedByTrackId } = deriveEffectiveAudibility({
            tracks: projectTracks,
            soloMode: workspaceStore.value?.soloMode ?? 'sip',
            stripTrackIds,
        });
        const sourceTracks = allRenderableTracks.filter((track) => audibleByTrackId.get(track.id) ?? !track.muted);
        const sidechainRoutes = sidechainStore.value?.routes ?? [];
        const routableSidechainTargets = new Set<object>();
        for (const route of sidechainRoutes) {
            const sourceTrack = allRenderableTracks.find((track) => track.id === route.sourceTrackId);
            const targetTrack = allRenderableTracks.find((track) => track.id === route.targetTrackId);
            const targetDevice = targetTrack?.devices.find(
                (device) => device.id === route.targetDeviceId && !device.bypassed
            );
            if (sourceTrack && targetDevice?.type === 'builtin-sidechain-compressor') {
                routableSidechainTargets.add(targetDevice);
            }
        }
        if (routableSidechainTargets.size > 0) {
            try {
                await prepareOfflineSidechainCompressor({
                    offlineCtx,
                    onWarning,
                    targetDevices: routableSidechainTargets,
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                onWarning?.(`Sidechain processor unavailable; using the offline compressor fallback. ${reason}`);
            }
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
        connectOfflineSidechainRoutes({
            offlineCtx,
            routes: sidechainRoutes,
            trackStripsById,
            deviceEntriesByTrack,
            // FX-5 — the export aligns the key off the same resolver the live
            // graph does, so a bounce ducks on the same phase as monitoring.
            keyDelaySecFor: getSidechainKeyDelay,
        });

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

        // FX-8 — a muted track is silenced by its own `postFaderGain`, which sits
        // downstream of the pre-fader send tap. Live, that leaves its pre-fader
        // (cue) sends still feeding their buses, which is the defining property of
        // a pre-fader tap. The mixdown expressed the mute a second time by refusing
        // to schedule the track at all, so export silently lost cue-send content the
        // engineer was monitoring. Those tracks are scheduled again; their strip's
        // mute node still keeps their direct output out of the mix.
        //
        // Solo gating is the opposite case and stays excluded: solo-in-place means
        // "play me only this", so a gated track must feed nothing, return buses
        // included. A muted track with no live pre-fader send is also still skipped,
        // so the render never does work whose output cannot reach the mix.
        const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
        const cueSendOnlyTracks = allRenderableTracks.filter((track) => {
            if (sourceTrackIds.has(track.id) || (soloGatedByTrackId.get(track.id) ?? false)) {
                return false;
            }
            return track.sends.some((send) => send.preFader && busStripsById.has(send.busId));
        });
        const scheduledTracks = [...sourceTracks, ...cueSendOnlyTracks];

        // Schedule the tracks that can still reach the mix — audible ones plus the
        // cue-send-only ones above — while keeping the full routing graph alive so
        // buses, targets, and the master strip behave like live playback.
        for (const track of scheduledTracks) {
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
                    projectChordPitch,
                    evaluateAutomationValue,
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

        // Render in suspendable segments. Each boundary is both a
        // real abort point (a cancelled render is left suspended rather than
        // running to completion in the background) and the only truthful
        // progress signal the API offers, replacing the old eased timer that
        // animated toward 97% regardless of what the renderer was doing.
        // Scheduling owns 0-50%, so the render phase maps onto the back half.
        const schedulingFrac = sourceTracks.length > 0 ? 0.5 : 0;
        const renderTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
        const buffer = await renderInSegments({
            offlineCtx,
            durationSeconds,
            timeoutMs: renderTimeoutMs,
            onRenderProgress: onProgress
                ? (fraction) => onProgress(schedulingFrac + fraction * (1 - schedulingFrac))
                : undefined,
        });

        onProgress?.(1);
        return buffer;
    } finally {
        releaseLock();
    }
};
