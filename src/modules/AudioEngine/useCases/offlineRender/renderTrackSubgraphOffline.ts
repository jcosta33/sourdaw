import { deriveVcaMultiplier, getVcaGroupsState, type Track } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { clampRenderFrameCount } from '../../repositories/clampRenderFrameCount';
import { connectOfflineSidechainRoutes } from '../../repositories/offlineRouting/connectOfflineSidechainRoutes';
import { makeOfflineFrameScheduler } from '../../repositories/offlineScheduler/makeOfflineFrameScheduler';
import { type DeviceNodeEntry } from '../buildDeviceChain';
import { getAudioContext } from '../engineAccess/getAudioContext';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';

import { captureOfflineSubgraphInput } from './captureOfflineSubgraphInput';
import { collectDeviceRuntimeFailures } from './collectDeviceRuntimeFailures';
import { collectWiredSidechainDetectorRoutes } from './collectWiredSidechainDetectorRoutes';
import { composeOfflineStripLevel } from './composeOfflineStripLevel';
import { connectOfflineToasterPadRoutes } from './connectOfflineToasterPadRoutes';
import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER } from './constants';
import { createOfflineAdjustmentBusChain, type OfflineAdjustmentBus } from './createOfflineAdjustmentBusChain';
import { createOfflineTrackStrip } from './createOfflineTrackStrip';
import { cropHistoryFromRenderedBuffer } from './cropHistoryFromRenderedBuffer';
import { destroyOfflineDeviceStrategies } from './destroyOfflineDeviceStrategies';
import { resolveTrackAdjustmentComposition } from './offlineAdjustmentLayers';
import { type OfflineRenderProjectSource, type OfflineRenderRuntimeSource } from './OfflineRenderSource';
import { prepareOfflineContext } from './prepareOfflineContext';
import { projectStripTrack, type TargetMixerDisposition } from './projectStripTrack';
import { readOfflineAdjustmentLayerSnapshot } from './readOfflineAdjustmentLayerSnapshot';
import { renderInSegments } from './renderInSegments';
import { resolveHistoryAwareRenderContext } from './resolveHistoryAwareRenderContext';
import { resolvePrintReachability } from './resolvePrintReachability';
import { scheduleOfflineAdjustmentCurves } from './scheduleOfflineAdjustmentCurves';
import { schedulePendingSuspends } from './schedulePendingSuspends';
import { scheduleTrackClips } from './scheduleTrackClips';
import { type OfflineScheduleTally, type OfflineTrackStrip, type PendingWorkletEvent } from './types';
import { wireAdjustmentBusChain } from './wireAdjustmentBusChain';
import { yieldToMain } from './yieldToMain';

/** Stand-in note tables for a render started before the MIDI store is hydrated. */
const EMPTY_MIDI_STATE = {
    probabilitySeed: 0,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
} as const;

export type ResolveContributorVcaMultiplierInput = {
    track: Track;
    isTarget: boolean;
    groups: ReturnType<typeof getVcaGroupsState>;
    /**
     * Whether the target itself should also receive its group master. See
     * `includeTargetVca` on `renderTrackSubgraphOffline` for the rule this
     * flips.
     */
    includeTargetVca?: boolean;
};

/**
 * The VCA group master to bake into one track of this render.
 *
 * **Upstream contributors always get it.** Their audio is summed into the print
 * exactly once and is never recomposed afterwards: the routing edge that got
 * baked stops carrying live signal the moment the target is frozen, so whatever
 * their group master was worth has to be in the samples or it is lost for good.
 *
 * **The target does not, by default.** Freeze and bounce replay their buffer
 * through the very strip that stays live afterwards, and `applyVcaGains` / the
 * gain-automation branch keep driving that same fader — baking the multiplier
 * in here would apply the group twice, once in the buffer and again on the
 * fader the buffer is replayed through.
 *
 * **`includeTargetVca` opts the target in.** A measurement's render is never
 * replayed through a live strip — nothing downstream will ever apply the
 * group again — so leaving it out here would drop it from the measured figure
 * entirely rather than double it. Freeze and bounce never set this; only a
 * caller whose buffer is the end of the line does.
 */
function resolveContributorVcaMultiplier({
    track,
    isTarget,
    groups,
    includeTargetVca = false,
}: ResolveContributorVcaMultiplierInput): number {
    if (isTarget && !includeTargetVca) {
        return 1;
    }

    return deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups });
}

type RenderTrackSubgraphOfflineInput = {
    /** Track whose strip output is captured into the returned buffer. */
    targetTrackId: string;
    /**
     * Target track plus its upstream routing subgraph, in project order. The
     * caller owns subgraph selection (Arrangement's routing rules); this use
     * case only renders what it is handed.
     */
    renderTracks: readonly Track[];
    /**
     * Tracks besides the target whose strip output mixes into the print — the
     * send-return buses a bounce includes so the wet path it prints reaches the
     * destination. A return's own `outputId` lies outside the subgraph, so
     * without this its processed output routes nowhere. The caller owns the
     * selection; this use case only wires what it is handed.
     */
    printTrackIds?: readonly string[];
    startBeat: number;
    endBeat: number;
    /** Seconds appended after the region so reverb/delay tails ring out. */
    tailSeconds?: number;
    /** False keeps only the instrument devices on the target track. */
    includeInserts?: boolean;
    /** False renders the target at neutral fader/pan and skips its automation. */
    includeAutomation?: boolean;
    /** False drops the target track's bus sends from the render graph. */
    includeSends?: boolean;
    /**
     * Whether the target track's own fader and panner belong in the print.
     *
     * Defaults to `'bake'`, which is right for every caller whose output is
     * finished audio. Freeze passes `'keepLive'`: its buffer is replayed through
     * that very strip, so baking those values applies them twice. See
     * `projectStripTrack` for the rule.
     */
    targetMixer?: TargetMixerDisposition;
    /**
     * Whether the target's own VCA group master is baked into the print.
     *
     * Defaults to `false`, matching freeze and bounce: the target's strip stays
     * live after the render and keeps applying that group itself. A caller
     * whose buffer is never replayed through a live strip — a measurement —
     * sets this `true` so the group is not silently dropped from what it
     * reports. See `resolveContributorVcaMultiplier` for the full rule.
     */
    includeTargetVca?: boolean;
    onProgress?: (fraction: number) => void;
    onWarning?: (message: string) => void;
    /**
     * Reports what the scheduler actually put into the graph, once scheduling
     * is complete and before the render runs. Every track of the subgraph feeds
     * one tally: they all sum into the target's output, so the target being
     * silent while *anything* upstream was scheduled is the interesting case.
     */
    onScheduled?: (tally: OfflineScheduleTally) => void;
    abortSignal?: AbortSignal;
    /**
     * The document to render in place of the live project — an isolated
     * command preview, for one. Every project read this render makes then
     * comes from it, all taken before the render first yields; `renderTracks`
     * must be that document's tracks. Absent, the render reads the live
     * project exactly as it always has.
     */
    source?: { project: OfflineRenderProjectSource; runtime?: OfflineRenderRuntimeSource };
};

/**
 * Render one track (plus everything routed into it) offline through the *real*
 * device graph — the same strip topology, instrument nodes and note scheduling
 * the live engine uses, in an `OfflineAudioContext`.
 *
 * This is the single offline render for freeze and bounce. Before MD-4 those
 * paths owned a parallel renderer that synthesised every MIDI instrument as a
 * fixed triangle oscillator, so frozen buffers and bounced clips — which are
 * deliverable audio, not previews — carried a caricature of the track instead
 * of its instrument.
 */
export async function renderTrackSubgraphOffline({
    targetTrackId,
    renderTracks,
    printTrackIds = [],
    startBeat,
    endBeat,
    tailSeconds = 0,
    includeInserts = true,
    includeAutomation = true,
    includeSends = true,
    targetMixer = 'bake',
    includeTargetVca = false,
    onProgress,
    onWarning,
    onScheduled,
    abortSignal,
    source,
}: RenderTrackSubgraphOfflineInput): Promise<AudioBuffer | null> {
    const durationBeats = endBeat - startBeat;
    if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
        return null;
    }

    const sampleRate = getAudioContext().sampleRate;
    const { renderContext, historySeconds, outputDurationSeconds } = resolveHistoryAwareRenderContext(
        { durationBeats, startBeat, tailSeconds, sampleRate },
        source?.project
    );
    const captured = source === undefined ? null : captureOfflineSubgraphInput({ source, renderTracks, sampleRate });
    const { midi, defaultTempo, changes, durationSeconds, ...projections } = renderContext;
    const {
        projectMidiEvents,
        projectPpqEndpoints,
        selectMidiEventProbability,
        projectChordPitch,
        resolveTempoAtBeat,
    } = projections;
    if (
        !projectMidiEvents ||
        !projectPpqEndpoints ||
        !selectMidiEventProbability ||
        !projectChordPitch ||
        !resolveTempoAtBeat
    ) {
        throw new Error('Offline musical projection is not configured');
    }

    // Shared with the mixdown and the stem path so an over-long freeze is
    // *reported* rather than silently producing a short buffer that looks like a
    // success. This used to re-inline the `Math.min`, which is the same clamp
    // with no warning channel — and `onWarning` was already in scope.
    const frameCount = clampRenderFrameCount({ durationSeconds, sampleRate, onWarning });
    if (frameCount <= 0) {
        return null;
    }
    const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
    // The frame scheduler for this context. One instance per
    // `OfflineAudioContext` comes back from the factory, so this path's Faust
    // devices share it rather than racing a second suspend for the same frame.
    const scheduleFrame = makeOfflineFrameScheduler(offlineCtx);

    const sidechainRoutes = captured?.scheduling.latency.routes ?? sidechainStore.value?.routes ?? [];

    // Before any strip exists. Both out-of-band devices build their worklet node
    // synchronously inside `createOfflineTrackStrip`, so a module registered
    // afterwards is registered too late and the device degrades silently.
    const renderTrackIds = new Set(renderTracks.map((track) => track.id));
    const wiredDetectorRoutes = collectWiredSidechainDetectorRoutes({ tracks: renderTracks, routes: sidechainRoutes });
    const keyedSidechainDevices = new Set<object>(wiredDetectorRoutes.map((route) => route.targetDevice));
    /** Tracks whose only role here is feeding a keyed device's detector. */
    const sidechainKeySourceIds = new Set(wiredDetectorRoutes.map((route) => route.sourceTrackId));

    // Which strips this render's print can actually carry, from the routing
    // graph rather than from each strip's own mute alone (#4376). A content
    // contributor routed into a muted key source is silent here even though its
    // own mute is not the one that silenced it — the same answer the mixdown
    // reaches from the same computation.
    const printedTrackIds = new Set([targetTrackId, ...printTrackIds]);
    const contributingTrackIds = resolvePrintReachability({
        tracks: renderTracks,
        honorMuted: (trackId) => sidechainKeySourceIds.has(trackId),
        sendsRendered: (trackId) => (trackId === targetTrackId ? includeSends : true),
        detectorRoutes: wiredDetectorRoutes,
        resolveOutputRoute: (track) => {
            if (printedTrackIds.has(track.id)) {
                return { kind: 'prints' };
            }
            if (renderTrackIds.has(track.outputId)) {
                return { kind: 'strip', trackId: track.outputId };
            }
            return { kind: 'outside-render' };
        },
    });

    await prepareOfflineContext({
        offlineCtx,
        tracks: renderTracks,
        sidechainTargetDevices: keyedSidechainDevices,
        onWarning,
    });

    // Snapshot once: every strip and every gain lane in this render must see the
    // same group levels, however long the render takes.
    const vcaGroups = captured?.vcaGroups ?? getVcaGroupsState();

    // One snapshot of the adjustment-layer stack, and each track's composition
    // over the exact span this render covers. A freeze with `keepLive` mixer
    // disposition is the exception below: its buffer replays through the live
    // strip, which keeps applying the layers itself, so baking them would
    // apply them twice — the same rule `projectStripTrack` applies to the
    // fader and panner those layers compose onto.
    const adjustmentLayers = readOfflineAdjustmentLayerSnapshot();
    const allTrackIds = renderTracks.map((track) => track.id);
    const compositionsByTrackId = new Map(
        renderTracks.map((track) => [
            track.id,
            resolveTrackAdjustmentComposition({
                layers: adjustmentLayers,
                trackId: track.id,
                allTrackIds,
                spanStartBeat: startBeat,
                spanEndBeat: endBeat,
            }),
        ])
    );
    const trackReceivesAdjustmentLayers = (trackId: string): boolean =>
        !(trackId === targetTrackId && targetMixer === 'keepLive');
    const adjustmentBusesByTrackId = new Map<string, OfflineAdjustmentBus[]>();
    let warnedMovingDsp = false;
    for (const track of renderTracks) {
        const composition = compositionsByTrackId.get(track.id);
        if (!composition || composition.dsp.length === 0 || !trackReceivesAdjustmentLayers(track.id)) {
            continue;
        }
        // A moving blend would need per-block crossfade writes through the
        // live bus node's slewed API; until that exists, a steady layer is
        // rendered and a moving one is skipped — loudly, never silently.
        if (!composition.constant) {
            if (!warnedMovingDsp) {
                warnedMovingDsp = true;
                onWarning?.(
                    'A DSP adjustment layer that fades across this bounce is skipped; only steady layers render offline.'
                );
            }
            continue;
        }
        adjustmentBusesByTrackId.set(
            track.id,
            createOfflineAdjustmentBusChain({ context: offlineCtx, layers: composition.dsp })
        );
    }

    const trackStripsById = new Map<string, OfflineTrackStrip>();
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
    // Everything from the first strip on is inside the teardown's scope. Every
    // metered native device takes a telemetry slot at construction and only
    // `destroy()` gives it back, so a render that times out, faults or is
    // cancelled has to release exactly what a successful one does — hence a
    // `finally` rather than a line after the returned buffer.
    try {
        for (const track of renderTracks) {
            const honorMuted = sidechainKeySourceIds.has(track.id);
            const projected = projectStripTrack({
                track,
                isTarget: track.id === targetTrackId,
                includeInserts,
                includeAutomation,
                targetMixer,
            });
            // The adjustment-layer composition folds into the same seed the
            // VCA multiplier folds into — multiply, then let the strip clamp —
            // which is live's composed fader write.
            const composition = compositionsByTrackId.get(track.id);
            let level = { gain: projected.gain, pan: projected.pan };
            if (composition && trackReceivesAdjustmentLayers(track.id)) {
                level = composeOfflineStripLevel({ gain: projected.gain, pan: projected.pan }, composition);
            }
            const strip = await createOfflineTrackStrip(
                offlineCtx,
                { ...projected, gain: level.gain, pan: level.pan },
                // Freeze and bounce produce deliverable audio, not a monitoring
                // snapshot — the same reason exportStems opts out. Baking mute in
                // would hand back a zeroed buffer, and bounce-to-new-track then
                // shows that silent waveform on an unmuted track. The renderer this
                // replaced never consulted `muted` at all.
                //
                // The one exception is the sidechain-key role. Live taps the key
                // after `TrackNode.setMute` has zeroed `postFaderGain` (the
                // analyser hangs off the panner), so a muted key feeds the
                // detector silence and its compression disappears. Force-unmuting
                // the key's strip here prints compression the monitored sound does
                // not have. Target and content contributors keep the force-unmute
                // above; only a track whose detector feed this render wires gets
                // its own mute honored.
                //
                // The VCA multiplier is per-track and asymmetric here; see
                // `resolveContributorVcaMultiplier` for why the target is the one
                // track that does not get it.
                {
                    honorMuted,
                    vcaMultiplier: resolveContributorVcaMultiplier({
                        track,
                        isTarget: track.id === targetTrackId,
                        groups: vcaGroups,
                        includeTargetVca,
                    }),
                    contributesAudio: contributingTrackIds.has(track.id),
                    onWarning,
                    instruments: captured?.instruments,
                    loadedExternalInstanceIds: captured?.loadedExternalInstanceIds,
                }
            );
            trackStripsById.set(track.id, strip);
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
        }

        connectOfflineToasterPadRoutes({ tracks: renderTracks, trackStripsById, deviceEntriesByTrack });

        connectOfflineSidechainRoutes({
            offlineCtx,
            routes: sidechainRoutes,
            trackStripsById,
            deviceEntriesByTrack,
            keyDelaySecFor: (route) => getSidechainKeyDelay(route, captured?.scheduling.latency),
        });

        for (const track of renderTracks) {
            const strip = trackStripsById.get(track.id);
            if (!strip) {
                continue;
            }

            // The destination — the print, or the next strip downstream — with
            // the track's DSP adjustment buses inserted in between when it has
            // them (live routes the strip output through the bus chain).
            let destination: AudioNode | null = trackStripsById.get(track.outputId)?.inputNode ?? null;
            if (track.id === targetTrackId || printTrackIds.includes(track.id)) {
                destination = offlineCtx.destination;
            }
            if (destination) {
                const buses = adjustmentBusesByTrackId.get(track.id);
                if (buses) {
                    wireAdjustmentBusChain(strip.outputNode, buses, destination);
                } else {
                    strip.outputNode.connect(destination);
                }
            }

            const sendsRendered = track.id === targetTrackId ? includeSends : true;
            if (!sendsRendered) {
                continue;
            }
            for (const send of track.sends) {
                const busStrip = trackStripsById.get(send.busId);
                if (!busStrip) {
                    continue;
                }
                const sendGain = offlineCtx.createGain();
                sendGain.gain.value = Math.max(0, Math.min(1, send.level));
                const tapNode = send.preFader ? strip.preFaderTap : strip.outputNode;
                tapNode.connect(sendGain);
                sendGain.connect(busStrip.inputNode);
            }
        }

        // A volume/pan composition that moves across the span is sampled per
        // slew tick onto the strip's fader and panner — the moving
        // composition's version of the seed fold in the strip build above.
        const adjustmentTickSeconds = automationSlewTickSecondsForGrain(
            captured?.scheduling.scheduleGrainMs ??
                transportStore.value?.scheduleGrainMs ??
                defaultTransportState.scheduleGrainMs
        );
        for (const track of renderTracks) {
            const strip = trackStripsById.get(track.id);
            const composition = compositionsByTrackId.get(track.id);
            if (!strip || !composition || composition.constant || !trackReceivesAdjustmentLayers(track.id)) {
                continue;
            }
            scheduleOfflineAdjustmentCurves({
                layers: adjustmentLayers,
                trackId: track.id,
                allTrackIds,
                composition,
                trackGainNode: strip.faderNode,
                trackPanNode: strip.panNode,
                baseGain: track.gain,
                basePan: track.pan,
                vcaMultiplier: resolveContributorVcaMultiplier({
                    track,
                    isTarget: track.id === targetTrackId,
                    groups: vcaGroups,
                    includeTargetVca,
                }),
                durationSeconds,
                regionStartBeat: startBeat,
                tickSeconds: adjustmentTickSeconds,
                defaultTempo,
                changes,
                compensationDelaySec: getCompensationDelay(track.id),
            });
        }

        // An audio-only freeze can run before any MIDI has been loaded; the
        // scheduler only reads note tables, so an empty one is the honest input.
        const midiState = midi ?? EMPTY_MIDI_STATE;
        const pendingWorkletEvents: PendingWorkletEvent[] = [];
        const tally: OfflineScheduleTally = { scheduledNotes: 0, scheduledBuffers: [], withheldDeviceTypes: [] };
        for (const track of renderTracks) {
            const strip = trackStripsById.get(track.id);
            if (!strip) {
                continue;
            }

            await scheduleTrackClips({
                captured: captured?.scheduling,
                offlineCtx,
                track,
                midi: midiState,
                trackInputNode: strip.inputNode,
                trackGainNode: strip.faderNode,
                trackPreFaderTap: strip.preFaderTap,
                trackPanNode: strip.panNode,
                destination: offlineCtx.destination,
                durationSeconds,
                defaultTempo,
                changes,
                projections: {
                    projectMidiEvents,
                    projectPpqEndpoints,
                    resolveTempoAtBeat,
                    processYeastMidi: projections.processYeastMidi,
                    selectMidiEventProbability,
                    projectChordPitch,
                    evaluateAutomationValue: projections.evaluateAutomationValue,
                    resolveArticulationId: projections.resolveArticulationId,
                    projectClipControllers: projections.projectClipControllers,
                },
                onWarning,
                pendingWorkletEvents,
                allTracks: renderTracks,
                deviceEntriesByTrack,
                honorMuted: false,
                regionStartBeat: 0,
                scheduleFrame,
                tallyStartSeconds: historySeconds,
                includeAutomation: track.id === targetTrackId ? includeAutomation : true,
                // Same rule as the strip seed: a `gain` or `pan` lane drives the very
                // nodes the frozen buffer is replayed through, and live
                // `applyAutomation` keeps driving them after the freeze, so baking
                // those lanes doubles them exactly as the static values were.
                // Device lanes are untouched — the chain is bypassed at replay, so
                // their moves exist only if they are in the samples.
                includeMixerAutomation: !(track.id === targetTrackId && targetMixer === 'keepLive'),
                // Same rule the strip was seeded with, so a gain lane on an upstream
                // contributor rides its group instead of nullifying it.
                vcaMultiplier: resolveContributorVcaMultiplier({
                    track,
                    isTarget: track.id === targetTrackId,
                    groups: vcaGroups,
                    includeTargetVca,
                }),
                tally,
                abortSignal,
            });
        }

        onScheduled?.(tally);

        schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

        await yieldToMain();

        if (abortSignal?.aborted) {
            throw new Error('Render aborted');
        }

        // The same segmented kernel the mixdown and stem exports use, rather than a
        // second copy of it. Two things this path did not have before: a wall-clock
        // backstop, so a wedged freeze can no longer hang indefinitely, and teardown
        // of the context it abandons.
        //
        // The stop signal is this render's own `AbortSignal`, deliberately not the
        // global export cancel flag — cancelling an export must not kill a freeze.
        const renderTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
        const buffer = await renderInSegments({
            offlineCtx,
            durationSeconds,
            timeoutMs: renderTimeoutMs,
            ...collectDeviceRuntimeFailures(deviceEntriesByTrack),
            onRenderProgress: onProgress,
            cancelSource: {
                isCancelled: () => abortSignal?.aborted ?? false,
                createCancelError: () => new Error('Render aborted'),
            },
        });

        onProgress?.(1);
        return cropHistoryFromRenderedBuffer({ buffer, historySeconds, outputDurationSeconds });
    } finally {
        destroyOfflineDeviceStrategies(deviceEntriesByTrack);
    }
}
