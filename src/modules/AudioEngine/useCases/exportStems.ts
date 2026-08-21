import {
    deriveVcaMultiplier,
    getVcaGroupsState,
    shouldCreateLiveTrackStrip,
    type getTrackEligibility,
} from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { createExportError } from '../errors/ExportError';
import { connectOfflineSidechainRoutes } from '../repositories/offlineRouting/connectOfflineSidechainRoutes';

import { type DeviceNodeEntry } from './buildDeviceChain';
import { getSidechainKeyDelay } from './latencyCompensation/compensation/getSidechainKeyDelay';
import { acquireRenderLock } from './offlineRender/acquireRenderLock';
import { checkCancel } from './offlineRender/checkCancel';
import { clampRenderFrameCount } from './offlineRender/clampRenderFrameCount';
import { collectDeviceRuntimeFailures } from './offlineRender/collectDeviceRuntimeFailures';
import { connectOfflineToasterPadRoutes } from './offlineRender/connectOfflineToasterPadRoutes';
import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER } from './offlineRender/constants';
import { createOfflineTrackStrip } from './offlineRender/createOfflineTrackStrip';
import { cropHistoryFromRenderedBuffer } from './offlineRender/cropHistoryFromRenderedBuffer';
import { destroyOfflineDeviceStrategies } from './offlineRender/destroyOfflineDeviceStrategies';
import { isCancelRequested } from './offlineRender/isCancelRequested';
import { prepareOfflineContext } from './offlineRender/prepareOfflineContext';
import { renderInSegments } from './offlineRender/renderInSegments';
import { resetCancelFlag } from './offlineRender/resetCancelFlag';
import { resolveHistoryAwareRenderContext } from './offlineRender/resolveHistoryAwareRenderContext';
import { schedulePendingSuspends } from './offlineRender/schedulePendingSuspends';
import { scheduleTrackClips } from './offlineRender/scheduleTrackClips';
import { type OfflineRenderOptions, type OfflineTrackStrip, type PendingWorkletEvent } from './offlineRender/types';
import { yieldToMain } from './offlineRender/yieldToMain';
import { resolveToasterPadBinding } from './resolveToasterPadBinding';

type ExportStemsFn = {
    (opts: OfflineRenderOptions): Promise<Map<string, AudioBuffer>>;
    (durationBeats: number, sampleRate?: number): Promise<Map<string, AudioBuffer>>;
};

/**
 * FX-9 — which sidechain keys a single stem has to reproduce, and which extra
 * tracks must exist in that stem's context to drive them.
 *
 * A sidechain compressor is an insert on the stem's *own* track, so its gain
 * reduction is part of that track's processed output — not a property of the
 * mix around it. Rendering the insert without its key left the stem carrying a
 * compressor that never compressed, so the stems could not be summed back into
 * the mixdown they came from. Each stem gets its own `OfflineAudioContext`
 * containing only that track, so the key source has to be rebuilt inside it.
 *
 * The key source is an auxiliary, never a second voice: the caller builds a
 * strip for it and wires it to the detector, but never to the destination.
 */
type StemSidechainRoute = {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
};

type StemSidechainTrack = {
    id: string;
    disabled: boolean;
    // Same eligibility kind `shouldCreateOfflineStrip` takes, so the key source
    // is filtered by the one strip-eligibility rule rather than a parallel one.
    kind: Parameters<typeof getTrackEligibility>[0];
    devices: readonly { id: string; type: string; bypassed: boolean }[];
};

type PlanStemSidechainInput<TTrack extends StemSidechainTrack> = {
    routes: readonly StemSidechainRoute[];
    /** The tracks this stem already renders — its own track plus grouped pads. */
    stemTrackIds: ReadonlySet<string>;
    allTracks: readonly TTrack[];
};

type PlanStemSidechainOutput<TTrack extends StemSidechainTrack> = {
    routes: StemSidechainRoute[];
    targetDevices: Set<object>;
    keySourceTracks: TTrack[];
};

function planStemSidechain<TTrack extends StemSidechainTrack>({
    routes,
    stemTrackIds,
    allTracks,
}: PlanStemSidechainInput<TTrack>): PlanStemSidechainOutput<TTrack> {
    const stemRoutes: StemSidechainRoute[] = [];
    const targetDevices = new Set<object>();
    const keySourceTracks: TTrack[] = [];
    const seenKeySourceIds = new Set<string>();

    for (const route of routes) {
        if (!stemTrackIds.has(route.targetTrackId)) {
            continue;
        }
        const targetTrack = allTracks.find((candidate) => candidate.id === route.targetTrackId);
        const targetDevice = targetTrack?.devices.find(
            (device) => device.id === route.targetDeviceId && !device.bypassed
        );
        if (targetDevice?.type !== 'builtin-sidechain-compressor') {
            continue;
        }
        const sourceTrack = allTracks.find((candidate) => candidate.id === route.sourceTrackId);
        // A key whose source left the project (or cannot own a strip) is dropped
        // rather than rendered silent, matching the mixdown's route filter.
        if (!sourceTrack || sourceTrack.disabled || !shouldCreateLiveTrackStrip(sourceTrack)) {
            continue;
        }

        stemRoutes.push(route);
        targetDevices.add(targetDevice);
        // A track can key a compressor on itself; it is already in the stem, so
        // it needs no second strip.
        if (!stemTrackIds.has(sourceTrack.id) && !seenKeySourceIds.has(sourceTrack.id)) {
            seenKeySourceIds.add(sourceTrack.id);
            keySourceTracks.push(sourceTrack);
        }
    }

    return { routes: stemRoutes, targetDevices, keySourceTracks };
}

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

        const { renderContext, historySeconds, outputDurationSeconds } = resolveHistoryAwareRenderContext({
            durationBeats,
            startBeat,
            tailSeconds,
            sampleRate,
        });
        const {
            tracks,
            midi,
            defaultTempo,
            changes,
            durationSeconds,
            projectMidiEvents,
            selectMidiEventProbability,
            projectPpqEndpoints,
            resolveTempoAtBeat,
            processYeastMidi,
            projectChordPitch,
            evaluateAutomationValue,
            resolveArticulationId,
        } = renderContext;
        const stems = new Map<string, AudioBuffer>();
        // FX-9 — read once; each stem then plans only the routes that key a device
        // it actually renders.
        const sidechainRoutes = sidechainStore.value?.routes ?? [];
        // Snapshot once so every stem in the set is levelled against the same
        // group state, however long the whole export takes.
        const vcaGroups = getVcaGroupsState();

        if (!tracks || !midi) {
            onProgress?.(1);
            return stems;
        }
        if (
            !projectMidiEvents ||
            !selectMidiEventProbability ||
            !projectPpqEndpoints ||
            !projectChordPitch ||
            !resolveTempoAtBeat
        ) {
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

        const frameCount = clampRenderFrameCount({ durationSeconds, sampleRate, onWarning });
        // Dynamically scale CPU threads based on hardware, clamped to 8 max to prevent OOM.
        const MAX_CONCURRENT_RENDERS =
            typeof navigator !== 'undefined' ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 4;

        // A stem set is per-track by construction, so a per-track failure stays
        // per-track: the pool records it and carries on rather than discarding
        // every stem that already rendered.
        const failures: { trackId: string; reason: string }[] = [];

        const tasks = eligible.map((track) => async () => {
            checkCancel();

            const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
            const pendingWorkletEvents: PendingWorkletEvent[] = [];
            const boundPads = toasterParentIds.has(track.id)
                ? tracks.tracks.filter((candidate) => {
                      const binding = resolveToasterPadBinding(tracks.tracks, candidate.id);
                      return binding?.toasterParentTrackId === track.id;
                  })
                : [];
            const groupedPads = boundPads.filter(
                (candidate) => !candidate.disabled && shouldCreateLiveTrackStrip(candidate)
            );
            const groupedTracks = [track, ...groupedPads];
            const groupedTopology = [
                track,
                ...boundPads.map((pad) => (pad.freezeState.status === 'frozen' ? { ...pad, clips: [] } : pad)),
            ];
            const trackStripsById = new Map<string, OfflineTrackStrip>();
            const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
            // Per stem, because each stem builds its own context and its own
            // devices. A stem set of N tracks would otherwise leak N stems'
            // worth of telemetry slots, and the pool is 64 for the whole page.
            try {
                // FX-9 — plan the keys before any strip exists: the compressor node is
                // built by `createOfflineTrackStrip`, and it only becomes a keyable
                // worklet if this context was prepared first (same order as the mixdown).
                const stemSidechain = planStemSidechain({
                    routes: sidechainRoutes,
                    stemTrackIds: new Set(groupedTracks.map((groupedTrack) => groupedTrack.id)),
                    allTracks: tracks.tracks,
                });
                // Same ordering constraint the mixdown and the freeze path apply,
                // through the same function: both out-of-band devices build their
                // worklet node synchronously inside `createOfflineTrackStrip`, so a
                // module registered afterwards is registered too late.
                await prepareOfflineContext({
                    offlineCtx,
                    tracks: groupedTracks,
                    sidechainTargetDevices: stemSidechain.targetDevices,
                    onWarning,
                });
                for (const groupedTrack of groupedTracks) {
                    // Stems carry the track's content even when muted (see the
                    // eligibility comment above) — only the mixdown bakes mute in.
                    // A stem is a level, not a monitoring snapshot: the track's own
                    // fader is already baked in, and its VCA group master is part of
                    // the same balance, so it composes in here too. (Mute and solo
                    // stay ignored above — those are monitoring state, not level.)
                    const groupedStrip = await createOfflineTrackStrip(offlineCtx, groupedTrack, {
                        honorMuted: false,
                        vcaMultiplier: deriveVcaMultiplier({ vcaGroupId: groupedTrack.vcaGroupId, groups: vcaGroups }),
                        onWarning,
                    });
                    trackStripsById.set(groupedTrack.id, groupedStrip);
                    deviceEntriesByTrack.set(groupedTrack.id, groupedStrip.deviceEntries);
                }
                const strip = trackStripsById.get(track.id)!;
                if (groupedPads.length > 0) {
                    connectOfflineToasterPadRoutes({
                        tracks: groupedTopology,
                        trackStripsById,
                        deviceEntriesByTrack,
                    });
                    for (const pad of groupedPads) {
                        trackStripsById.get(pad.id)?.outputNode.connect(strip.inputNode);
                    }
                }
                strip.outputNode.connect(offlineCtx.destination);

                // FX-9 — the key sources: built and scheduled so the detector sees real
                // program, but deliberately never connected to `offlineCtx.destination`.
                // They shape this stem through the compressor's sidechain input only;
                // their own audio must not appear in it.
                //
                // Mute and solo are ignored here for the same reason the stem itself
                // ignores them (`honorMuted: false`): a stem set is "the session's full
                // content, track by track", so its keys are derived from that same full
                // content rather than from the monitoring state at export time.
                for (const keySourceTrack of stemSidechain.keySourceTracks) {
                    // The live compressor keys off a post-fader signal, which rides
                    // the key track's VCA group, so the offline key does too.
                    const keyStrip = await createOfflineTrackStrip(offlineCtx, keySourceTrack, {
                        honorMuted: false,
                        vcaMultiplier: deriveVcaMultiplier({
                            vcaGroupId: keySourceTrack.vcaGroupId,
                            groups: vcaGroups,
                        }),
                        onWarning,
                    });
                    trackStripsById.set(keySourceTrack.id, keyStrip);
                    deviceEntriesByTrack.set(keySourceTrack.id, keyStrip.deviceEntries);
                }
                if (stemSidechain.routes.length > 0) {
                    connectOfflineSidechainRoutes({
                        offlineCtx,
                        routes: stemSidechain.routes,
                        trackStripsById,
                        deviceEntriesByTrack,
                        // FX-5 — the same alignment resolver the mixdown and the live
                        // graph use, so a stem ducks on the phase it was monitored at.
                        keyDelaySecFor: getSidechainKeyDelay,
                    });
                }
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
                            resolveTempoAtBeat,
                            processYeastMidi,
                            selectMidiEventProbability,
                            projectChordPitch,
                            evaluateAutomationValue,
                            resolveArticulationId,
                        },
                        onWarning,
                        pendingWorkletEvents,
                        allTracks: groupedTopology,
                        deviceEntriesByTrack,
                        honorMuted: false,
                        regionStartBeat: 0,
                        vcaMultiplier: deriveVcaMultiplier({ vcaGroupId: groupedTrack.vcaGroupId, groups: vcaGroups }),
                    });
                }

                // FX-9 — a key strip with no program would duck nothing, so the key
                // sources are scheduled like any other track. `destination` is still the
                // context's, matching the grouped calls: it is the scheduler's reference
                // for tail/limit handling, not a connection of this strip's output.
                for (const keySourceTrack of stemSidechain.keySourceTracks) {
                    const keyStrip = trackStripsById.get(keySourceTrack.id)!;
                    await scheduleTrackClips({
                        offlineCtx,
                        track: keySourceTrack,
                        midi,
                        trackInputNode: keyStrip.inputNode,
                        trackGainNode: keyStrip.faderNode,
                        trackPanNode: keyStrip.panNode,
                        destination: offlineCtx.destination,
                        durationSeconds,
                        defaultTempo,
                        changes,
                        projections: {
                            projectMidiEvents,
                            projectPpqEndpoints,
                            resolveTempoAtBeat,
                            processYeastMidi,
                            selectMidiEventProbability,
                            projectChordPitch,
                            evaluateAutomationValue,
                            resolveArticulationId,
                        },
                        onWarning,
                        pendingWorkletEvents,
                        allTracks: tracks.tracks,
                        deviceEntriesByTrack,
                        honorMuted: false,
                        regionStartBeat: 0,
                        vcaMultiplier: deriveVcaMultiplier({
                            vcaGroupId: keySourceTrack.vcaGroupId,
                            groups: vcaGroups,
                        }),
                    });
                }

                schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

                // Emit scheduling-done progress (40% of this stem's slot) before the render blocks.
                const fractAfterSchedule = (done + 0.4) / eligible.length;
                onProgress?.(fractAfterSchedule);
                await yieldToMain();

                // Same segmented kernel the mixdown uses, so a stem
                // render aborts at a real boundary instead of running to completion
                // in the background (up to MAX_CONCURRENT_RENDERS of them at once),
                // and this stem's slot advances on measured render progress rather
                // than an eased timer.
                const stemSpan = 1 / eligible.length;
                const stemTimeoutMs = Math.max(
                    MIN_RENDER_TIMEOUT_MS,
                    durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000
                );
                const buffer = await renderInSegments({
                    offlineCtx,
                    durationSeconds,
                    timeoutMs: stemTimeoutMs,
                    ...collectDeviceRuntimeFailures(deviceEntriesByTrack),
                    onRenderProgress: onProgress
                        ? (fraction) => onProgress(fractAfterSchedule + fraction * (stemSpan * 0.6))
                        : undefined,
                });

                stems.set(track.id, cropHistoryFromRenderedBuffer({ buffer, historySeconds, outputDurationSeconds }));
                done++;
                onProgress?.(done / eligible.length);
            } finally {
                destroyOfflineDeviceStrategies(deviceEntriesByTrack);
            }
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
                    const task = tasks[taskIndex];
                    const stemTrackId = eligible[taskIndex]!.id;
                    taskIndex++;
                    activeTasks++;
                    function settle(): void {
                        activeTasks--;
                        if (taskIndex >= tasks.length && activeTasks === 0) {
                            resolve();
                            return;
                        }
                        // eslint-disable-next-line promise/no-callback-in-promise -- `next` is an internal concurrent-pool scheduler, not a Node-style callback; it re-enters the loop to start the next pending task
                        next();
                    }
                    task!()
                        .then(() => {
                            settle();
                            return null;
                        })
                        .catch((error: unknown) => {
                            let failure = new Error(String(error));
                            if (error instanceof Error) {
                                failure = error;
                            }
                            // A cancel is the whole export stopping, not this
                            // stem failing, so it still rejects the pool.
                            if (isCancelRequested()) {
                                reject(failure);
                                return;
                            }
                            failures.push({ trackId: stemTrackId, reason: failure.message });
                            // This stem's slot is spent either way; without this
                            // the progress bar stalls short of 1 on a failure.
                            done++;
                            onProgress?.(done / eligible.length);
                            settle();
                        });
                }
                if (taskIndex >= tasks.length && activeTasks === 0) {
                    resolve();
                }
            }
            next();
        });

        if (failures.length > 0) {
            const detail = failures.map((failure) => `${failure.trackId} (${failure.reason})`).join('; ');
            // Nothing rendered: returning an empty set would let the dialog
            // report success over an export that contains none of the session.
            if (stems.size === 0) {
                throw createExportError(`No stem could be rendered. Failed tracks: ${detail}`);
            }
            onWarning?.(
                `${failures.length} of ${eligible.length} stems could not be rendered and are missing from this ` +
                    `export. Failed tracks: ${detail}`
            );
        }

        return stems;
    } finally {
        releaseLock();
    }
};
