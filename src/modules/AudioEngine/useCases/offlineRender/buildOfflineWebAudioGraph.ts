import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { createExportError } from '../../errors/ExportError';
import { type AudioGraphApplyResult, type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { connectOfflineSidechainRoutes } from '../../repositories/offlineRouting/connectOfflineSidechainRoutes';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';
import { type LatencyCompensationInput } from '../latencyCompensation/compensation/LatencyCompensationInput';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { checkCancel } from './checkCancel';
import { composeOfflineStripLevel } from './composeOfflineStripLevel';
import { connectOfflineToasterPadRoutes } from './connectOfflineToasterPadRoutes';
import { createOfflineAdjustmentBusChain } from './createOfflineAdjustmentBusChain';
import { type WebAudioOfflineBackend } from './createWebAudioOfflineBackend';
import { resolveTrackAdjustmentComposition } from './offlineAdjustmentLayers';
import { prepareOfflineContext } from './prepareOfflineContext';
import { readOfflineAdjustmentLayerSnapshot } from './readOfflineAdjustmentLayerSnapshot';
import { type resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { resolveOutputTarget } from './resolveOutputTarget';
import { scheduleOfflineAdjustmentCurves } from './scheduleOfflineAdjustmentCurves';
import { type OfflineBusStrip, type OfflineRenderOptions, type OfflineTrackStrip } from './types';
import { wireAdjustmentBusChain } from './wireAdjustmentBusChain';

type GraphInput = {
    input: ReturnType<typeof captureOfflineRenderInput>;
    plan: ReturnType<typeof resolveOfflineMixPlan>;
    offlineCtx: OfflineAudioContext;
    backend: WebAudioOfflineBackend;
    /** Where a strip routed to `master` lands — the adjustment chains rewire that edge. */
    masterNode: AudioNode;
    onWarning?: OfflineRenderOptions['onWarning'];
    /** Stops this render alone, without the process-wide export cancel flag. */
    abortSignal?: AbortSignal;
};

/**
 * Fail the export when a batch was not applied whole.
 *
 * Before the seam existed a strip could not fail to appear: `createOfflineTrackStrip`
 * either returned one or threw, and a throw failed the export. A backend can
 * instead *refuse* — a schema mismatch, a stale correlation, a command it does
 * not implement — and a refusal read as "no strip" would drop the track out of
 * the render and hand the user a file quietly missing it. A refused routing
 * batch is worse still: the strip exists, nothing reaches it, and the mix is
 * silently short one track.
 */
function assertBatchApplied(result: AudioGraphApplyResult, attempt: string): void {
    if (result.application === 'applied') {
        return;
    }
    throw createExportError(`The audio backend refused to ${attempt}: ${result.reason}`);
}

/**
 * The render's beat span, widened conservatively: the last tempo change's beat
 * plus the whole duration walked at the slowest tempo in the map. Used only to
 * classify whether an adjustment layer's blend *moves* across the render — a
 * wider span can only answer "moves" more often, which costs the seed fold and
 * schedules the identical curve, never bakes a wrong level.
 */
function conservativeSpanEndBeat(
    durationSeconds: number,
    defaultTempo: number,
    changes: { beat: number; tempo: number }[]
): number {
    const slowestTempo = Math.min(defaultTempo, ...changes.map((change) => change.tempo));
    const lastChangeBeat = changes.reduce((beat, change) => Math.max(beat, change.beat), 0);
    return lastChangeBeat + (durationSeconds / 60) * slowestTempo;
}

async function routeOfflineStrips(
    { backend, plan }: GraphInput,
    trackStripsById: ReadonlyMap<string, OfflineTrackStrip>,
    busStripsById: ReadonlyMap<string, OfflineBusStrip>
) {
    const { allRenderableTracks } = plan;
    const sendAutomationParamsByTrack = new Map<string, ReadonlyMap<string, AudioParam>>();
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
            busStripIds: busStripsById,
            trackStripIds: trackStripsById,
        });

        const routingResult = await backend.apply({
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
        assertBatchApplied(routingResult, `route the output and sends of track "${track.name}"`);
        const sendAutomationParams = backend.getSendAutomationParams(track.id);
        if (sendAutomationParams) {
            sendAutomationParamsByTrack.set(track.id, sendAutomationParams);
        }
    }

    return sendAutomationParamsByTrack;
}

/**
 * Insert a track's DSP adjustment layers between its strip output and the
 * destination `set-track-output` wired — the offline twin of live's
 * `AdjustmentLayerRuntime` reroute. Post-fader sends tap the strip output
 * directly and are untouched, exactly as live's taps precede the reroute.
 */
function insertAdjustmentBusChains({
    offlineCtx,
    plan,
    compositionsByTrackId,
    trackStripsById,
    busStripsById,
    masterNode,
    onWarning,
}: {
    offlineCtx: OfflineAudioContext;
    plan: ReturnType<typeof resolveOfflineMixPlan>;
    compositionsByTrackId: ReadonlyMap<string, ReturnType<typeof resolveTrackAdjustmentComposition>>;
    trackStripsById: ReadonlyMap<string, OfflineTrackStrip>;
    busStripsById: ReadonlyMap<string, OfflineBusStrip>;
    masterNode: AudioNode;
    onWarning?: OfflineRenderOptions['onWarning'];
}): void {
    let warnedMovingDsp = false;
    for (const track of plan.allRenderableTracks) {
        const strip = trackStripsById.get(track.id);
        const composition = compositionsByTrackId.get(track.id);
        if (!strip || !composition || composition.dsp.length === 0) {
            continue;
        }
        // A moving blend would need per-block crossfade writes through the
        // live bus node's slewed API; until that exists, a steady layer is
        // rendered and a moving one is skipped — loudly, never silently.
        if (!composition.constant) {
            if (!warnedMovingDsp) {
                warnedMovingDsp = true;
                onWarning?.(
                    'A DSP adjustment layer that fades across this export is skipped; only steady layers render offline.'
                );
            }
            continue;
        }
        const outputTarget = resolveOutputTarget({
            outputId: track.outputId,
            busStripIds: busStripsById,
            trackStripIds: trackStripsById,
        });
        let targetNode: AudioNode = masterNode;
        if (outputTarget.kind === 'bus') {
            targetNode = busStripsById.get(outputTarget.busId)?.gainNode ?? masterNode;
        } else if (outputTarget.kind === 'track') {
            targetNode = trackStripsById.get(outputTarget.trackId)?.inputNode ?? masterNode;
        }
        try {
            strip.outputNode.disconnect(targetNode);
        } catch {
            // The edge `set-track-output` wired is the one being replaced; if
            // it was already gone there is nothing to unwind.
        }
        const buses = createOfflineAdjustmentBusChain({ context: offlineCtx, layers: composition.dsp });
        wireAdjustmentBusChain(strip.outputNode, buses, targetNode);
    }
}

/** Build on the caller-owned backend so every failure remains inside its disposal boundary. */
/**
 * A volume/pan composition that moves across the render is sampled per slew
 * tick onto the strip's fader and panner — the moving composition's version of
 * the seed fold in the strip build. The tick grain is the live scheduler's.
 */
function scheduleMovingAdjustmentCurves({
    plan,
    compositionsByTrackId,
    trackStripsById,
    adjustmentLayers,
    allTrackIds,
    latency,
    scheduleGrainMs,
}: {
    plan: ReturnType<typeof resolveOfflineMixPlan>;
    compositionsByTrackId: ReadonlyMap<string, ReturnType<typeof resolveTrackAdjustmentComposition>>;
    trackStripsById: ReadonlyMap<string, OfflineTrackStrip>;
    adjustmentLayers: ReturnType<typeof readOfflineAdjustmentLayerSnapshot>;
    allTrackIds: readonly string[];
    latency: LatencyCompensationInput;
    scheduleGrainMs: number;
}): void {
    const { allRenderableTracks, vcaMultiplierByTrackId, renderContext } = plan;
    const { durationSeconds, defaultTempo, changes } = renderContext;
    const tickSeconds = automationSlewTickSecondsForGrain(scheduleGrainMs);
    for (const track of allRenderableTracks) {
        const strip = trackStripsById.get(track.id);
        const composition = compositionsByTrackId.get(track.id);
        if (!strip || !composition || composition.constant) {
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
            vcaMultiplier: vcaMultiplierByTrackId.get(track.id) ?? 1,
            durationSeconds,
            regionStartBeat: 0,
            tickSeconds,
            defaultTempo,
            changes,
            compensationDelaySec: getCompensationDelay(track.id, undefined, undefined, latency),
        });
    }
}

/**
 * One snapshot of the adjustment-layer stack for the whole render, and each
 * renderable track's composition over it: every strip seed and every scheduled
 * curve reads the same layers, however long the render takes.
 */
function resolveTrackCompositionsForRender(
    allRenderableTracks: readonly { id: string }[],
    projectTrackIds: readonly string[],
    durationSeconds: number,
    defaultTempo: number,
    changes: { beat: number; tempo: number }[]
): {
    layers: ReturnType<typeof readOfflineAdjustmentLayerSnapshot>;
    allTrackIds: readonly string[];
    compositionsByTrackId: Map<string, ReturnType<typeof resolveTrackAdjustmentComposition>>;
} {
    const layers = readOfflineAdjustmentLayerSnapshot();
    const spanEndBeat = conservativeSpanEndBeat(durationSeconds, defaultTempo, changes);
    return {
        layers,
        allTrackIds: projectTrackIds,
        compositionsByTrackId: new Map(
            allRenderableTracks.map((track) => [
                track.id,
                resolveTrackAdjustmentComposition({
                    layers,
                    trackId: track.id,
                    allTrackIds: projectTrackIds,
                    spanStartBeat: 0,
                    spanEndBeat,
                }),
            ])
        ),
    };
}

export async function buildOfflineWebAudioGraph(args: GraphInput) {
    const { input, plan, offlineCtx, backend, masterNode, onWarning, abortSignal } = args;
    const {
        allRenderableTracks,
        routableSidechainTargets,
        contributingTrackIds,
        soloGatedByTrackId,
        vcaMultiplierByTrackId,
        renderContext: { tracks, durationSeconds, defaultTempo, changes },
    } = plan;
    const sidechainRoutes = input.scheduling.latency.routes;
    const trackStripsById = new Map<string, OfflineTrackStrip>();
    const busStripsById = new Map<string, OfflineBusStrip>();
    // A live view of the backend's own map, not a copy: sidechain routing,
    // Toaster routing, clip scheduling and the runtime-failure sweep all read
    // exactly the set of devices `dispose()` will destroy, so the read model
    // and the teardown root cannot diverge.
    const deviceEntriesByTrack = backend.getDeviceEntriesByTrack();
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

    // One snapshot of the adjustment-layer stack for the whole render: every
    // strip seed and every scheduled curve below reads the same layers,
    // however long the render takes.
    const {
        layers: adjustmentLayers,
        allTrackIds,
        compositionsByTrackId,
    } = resolveTrackCompositionsForRender(
        allRenderableTracks,
        (tracks?.tracks ?? allRenderableTracks).map((track) => track.id),
        durationSeconds,
        defaultTempo,
        changes
    );

    for (const track of allRenderableTracks) {
        checkCancel(abortSignal);
        const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;
        // Match live solo-in-place at the same topology point: closing the
        // strip's pre-fader tap also silences audio routed into this strip.
        const composition = compositionsByTrackId.get(track.id);
        let level = { gain: track.gain, pan: track.pan };
        if (composition) {
            level = composeOfflineStripLevel({ gain: track.gain, pan: track.pan }, composition);
        }
        const state = {
            gain: level.gain,
            pan: level.pan,
            muted: track.muted,
            soloGated: soloGatedByTrackId.get(track.id) ?? false,
            vcaMultiplier,
        };
        const common = {
            name: track.name,
            state,
            devices: track.devices,
            honorMuted: true,
            contributesAudio: contributingTrackIds.has(track.id),
        };
        let command: AudioGraphCommand;
        if (track.kind === 'bus') {
            command = { ...common, kind: 'create-bus-strip', busId: track.id };
        } else {
            command = { ...common, kind: 'create-track-strip', trackId: track.id };
        }
        const stripResult = await backend.apply({ schemaVersion: 1, commands: [command] });
        assertBatchApplied(stripResult, `build the strip for track "${track.name}"`);
        const strip = backend.getTrackStrip(track.id);
        if (!strip) {
            continue;
        }
        trackStripsById.set(track.id, strip);
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
        keyDelaySecFor: (route) => getSidechainKeyDelay(route, input.scheduling.latency),
    });

    const sendAutomationParamsByTrack = await routeOfflineStrips(args, trackStripsById, busStripsById);

    insertAdjustmentBusChains({
        offlineCtx,
        plan,
        compositionsByTrackId,
        trackStripsById,
        busStripsById,
        masterNode,
        onWarning,
    });

    scheduleMovingAdjustmentCurves({
        plan,
        compositionsByTrackId,
        trackStripsById,
        adjustmentLayers,
        allTrackIds,
        latency: input.scheduling.latency,
        scheduleGrainMs: input.scheduling.scheduleGrainMs,
    });

    return { trackStripsById, sendAutomationParamsByTrack, deviceEntriesByTrack };
}
