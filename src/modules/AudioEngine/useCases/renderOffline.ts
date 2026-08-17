import { deriveEffectiveAudibility, deriveVcaMultiplier, getVcaGroupsState } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { createExportError } from '../errors/ExportError';
import { type AudioGraphCommand, type AudioGraphRouteTarget } from '../models/AudioGraphBackend';
import { connectOfflineSidechainRoutes } from '../repositories/offlineRouting/connectOfflineSidechainRoutes';

import { type DeviceNodeEntry } from './buildDeviceChain';
import { getSidechainKeyDelay } from './latencyCompensation/compensation/getSidechainKeyDelay';
import { acquireRenderLock } from './offlineRender/acquireRenderLock';
import { checkCancel } from './offlineRender/checkCancel';
import { clampRenderFrameCount } from './offlineRender/clampRenderFrameCount';
import { collectDeviceRuntimeFailures } from './offlineRender/collectDeviceRuntimeFailures';
import { connectOfflineToasterPadRoutes } from './offlineRender/connectOfflineToasterPadRoutes';
import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER } from './offlineRender/constants';
import {
    createWebAudioOfflineBackend,
    type WebAudioOfflineBackend,
} from './offlineRender/createWebAudioOfflineBackend';
import { cropHistoryFromRenderedBuffer } from './offlineRender/cropHistoryFromRenderedBuffer';
import { prepareOfflineContext } from './offlineRender/prepareOfflineContext';
import { renderInSegments } from './offlineRender/renderInSegments';
import { resetCancelFlag } from './offlineRender/resetCancelFlag';
import { resolveHistoryAwareRenderContext } from './offlineRender/resolveHistoryAwareRenderContext';
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

type ResolveOutputTargetInput = {
    outputId: string | null | undefined;
    busStripsById: ReadonlyMap<string, OfflineBusStrip>;
    trackStripsById: ReadonlyMap<string, OfflineTrackStrip>;
};

/**
 * Which of the three destinations a track's stored output id names, decided
 * from the strips this render actually built: a bus first, then a track, then
 * master — including master as the fallback for an output id naming nothing
 * this render created.
 */
function resolveOutputTarget({
    outputId,
    busStripsById,
    trackStripsById,
}: ResolveOutputTargetInput): AudioGraphRouteTarget {
    if (outputId === 'hw_out' || !outputId) {
        return { kind: 'master' };
    }
    if (busStripsById.has(outputId)) {
        return { kind: 'bus', busId: outputId };
    }
    if (trackStripsById.has(outputId)) {
        return { kind: 'track', trackId: outputId };
    }
    return { kind: 'master' };
}

export const renderOffline: RenderOfflineFn = async function renderOffline(
    optsOrBeats: OfflineRenderOptions | number,
    maybeSampleRate?: number
): Promise<AudioBuffer> {
    const releaseLock = acquireRenderLock();
    // Declared outside the try so the teardown in `finally` can reach it on
    // every exit. Every metered native device this render builds takes a slot
    // from the shared 64-slot telemetry pool at construction, and `destroy()`
    // is the only thing that returns one — a garbage-collected
    // `OfflineAudioContext` returns nothing, so a leak here is permanent for
    // the page session and kills every meter added afterwards.
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
    // Owns every device this render constructs once it exists, so teardown in
    // the `finally` reaches them on every exit — including an exit taken before
    // the context, and therefore the backend, could be created.
    let backend: WebAudioOfflineBackend | undefined;

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

        const { renderContext, historySeconds, outputDurationSeconds } = resolveHistoryAwareRenderContext({
            durationBeats,
            startBeat,
            tailSeconds,
            sampleRate,
        });
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
            resolveArticulationId,
        } = renderContext;
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
        // Every strip, route and send this render builds goes through the
        // backend seam from here on. The bounce is the seam's first production
        // consumer; the native engine becomes the second by answering the same
        // commands (campaign D3).
        backend = createWebAudioOfflineBackend({ context: offlineCtx, masterNode: masterGain, onWarning });

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
        // Snapshot once: every strip and every gain lane in this render must see
        // the same group levels, however long the render takes.
        const vcaGroups = getVcaGroupsState();
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
        // Before any strip exists: both out-of-band devices build their worklet
        // node synchronously inside `createOfflineTrackStrip`, so a module
        // registered afterwards is registered too late and the device degrades
        // to its fallback. Shared with the stem path and the freeze path — the
        // three used to carry this ordering constraint in three copies, and the
        // freeze path carried neither prepare at all.
        await prepareOfflineContext({
            offlineCtx,
            tracks: allRenderableTracks,
            sidechainTargetDevices: routableSidechainTargets,
            onWarning,
        });
        let scheduled = 0;
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        // Build the same strip topology the live engine uses:
        // Track input -> devices -> pre-fader tap -> fader -> mute -> pan -> output routing.
        // Sends tap either pre-fader or post-pan. Return buses receive audio at
        // their owning track input so the persisted device chain and mixer state
        // are applied before the bus output reaches master.
        const trackStripsById = new Map<string, OfflineTrackStrip>();
        const busStripsById = new Map<string, OfflineBusStrip>();
        const sendAutomationParamsByTrack = new Map<string, ReadonlyMap<string, AudioParam>>();

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
        //
        // Resolved *before* the strips are built, because a strip has to know
        // whether it will be scheduled: a strip that is never scheduled
        // contributes silence, so an unrenderable device on it must degrade
        // rather than fail the whole export. Bus membership is read off the
        // track kind rather than off `busStripsById`, which does not exist yet
        // and is filled from exactly this set of tracks.
        const busTrackIds = new Set(
            allRenderableTracks.filter((track) => track.kind === 'bus').map((track) => track.id)
        );
        const sourceTrackIds = new Set(sourceTracks.map((track) => track.id));
        const cueSendOnlyTracks = allRenderableTracks.filter((track) => {
            if (sourceTrackIds.has(track.id) || (soloGatedByTrackId.get(track.id) ?? false)) {
                return false;
            }
            return track.sends.some((send) => send.preFader && busTrackIds.has(send.busId));
        });
        const scheduledTracks = [...sourceTracks, ...cueSendOnlyTracks];
        const scheduledTrackIds = new Set(scheduledTracks.map((track) => track.id));

        for (const track of allRenderableTracks) {
            checkCancel();
            // A VCA-member track plays through its group master, so the bounce
            // has to fold the same multiplier into its fader. This is the same
            // derivation the live path resolves through `getEffectiveGain`, and
            // it is 1 for a track in no group. Resolved here rather than inside
            // the strip so the strip builder stays a pure function of what it is
            // handed.
            const vcaMultiplier = deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups });
            // The mixdown does not gate a soloed-off track's strip; it leaves it
            // out of `scheduledTracks` instead. Passing `soloGated: false` keeps
            // that, rather than silently taking on the pre-fader gate the
            // contract now carries.
            const state = {
                gain: track.gain,
                pan: track.pan,
                muted: track.muted,
                soloGated: false,
                vcaMultiplier,
            };
            await backend.apply({
                schemaVersion: 1,
                commands: [
                    track.kind === 'bus'
                        ? {
                              kind: 'create-bus-strip',
                              busId: track.id,
                              name: track.name,
                              state,
                              devices: track.devices,
                              honorMuted: true,
                              contributesAudio: scheduledTrackIds.has(track.id),
                          }
                        : {
                              kind: 'create-track-strip',
                              trackId: track.id,
                              name: track.name,
                              state,
                              devices: track.devices,
                              honorMuted: true,
                              contributesAudio: scheduledTrackIds.has(track.id),
                          },
                ],
            });
            const strip = backend.getTrackStrip(track.id);
            if (!strip) {
                continue;
            }
            trackStripsById.set(track.id, strip);
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
            const busStrip = backend.getBusStrip(track.id);
            if (busStrip) {
                busStripsById.set(track.id, busStrip);
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

            // Which of the three destinations an output id names is decided
            // here, from the strips this render actually built, exactly as the
            // inline routing decided it: a bus first, then a track, then master.
            const outputTarget = resolveOutputTarget({
                outputId: track.outputId,
                busStripsById,
                trackStripsById,
            });

            await backend.apply({
                schemaVersion: 1,
                commands: [
                    { kind: 'set-track-output', trackId: track.id, target: outputTarget },
                    ...track.sends.map((send): AudioGraphCommand => ({
                        kind: 'add-send',
                        trackId: track.id,
                        busId: send.busId,
                        tap: send.preFader ? 'pre-fader' : 'post-fader',
                        level: send.level,
                    })),
                ],
            });
            const sendAutomationParams = backend.getSendAutomationParams(track.id);
            if (sendAutomationParams) {
                sendAutomationParamsByTrack.set(track.id, sendAutomationParams);
            }
        }

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
                sendAutomationParams: sendAutomationParamsByTrack.get(track.id),
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
                    resolveArticulationId,
                },
                onWarning,
                pendingWorkletEvents,
                // Keep canonical project order for Toaster pad indexes. The
                // scheduler skips inaudible children only after indexing.
                allTracks: tracks?.tracks ?? [],
                deviceEntriesByTrack,
                regionStartBeat: 0,
                // Same multiplier the strip was seeded with, so a gain lane on a
                // VCA-member track rides its group instead of nullifying it.
                vcaMultiplier: deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
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
            ...collectDeviceRuntimeFailures(deviceEntriesByTrack),
            onRenderProgress: onProgress
                ? (fraction) => onProgress(schedulingFrac + fraction * (1 - schedulingFrac))
                : undefined,
        });

        onProgress?.(1);
        return cropHistoryFromRenderedBuffer({ buffer, historySeconds, outputDurationSeconds });
    } finally {
        backend?.dispose();
        releaseLock();
    }
};
