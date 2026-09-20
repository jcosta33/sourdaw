import { createExportError } from '../../errors/ExportError';
import { type AudioGraphApplyResult, type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { connectOfflineSidechainRoutes } from '../../repositories/offlineRouting/connectOfflineSidechainRoutes';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { checkCancel } from './checkCancel';
import { connectOfflineToasterPadRoutes } from './connectOfflineToasterPadRoutes';
import { type WebAudioOfflineBackend } from './createWebAudioOfflineBackend';
import { prepareOfflineContext } from './prepareOfflineContext';
import { type resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { resolveOutputTarget } from './resolveOutputTarget';
import { type OfflineBusStrip, type OfflineRenderOptions, type OfflineTrackStrip } from './types';

type GraphInput = {
    input: ReturnType<typeof captureOfflineRenderInput>;
    plan: ReturnType<typeof resolveOfflineMixPlan>;
    offlineCtx: OfflineAudioContext;
    backend: WebAudioOfflineBackend;
    onWarning?: OfflineRenderOptions['onWarning'];
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

/** Build on the caller-owned backend so every failure remains inside its disposal boundary. */
export async function buildOfflineWebAudioGraph(args: GraphInput) {
    const { input, plan, offlineCtx, backend, onWarning } = args;
    const {
        allRenderableTracks,
        routableSidechainTargets,
        contributingTrackIds,
        soloGatedByTrackId,
        vcaMultiplierByTrackId,
        renderContext: { tracks },
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

    for (const track of allRenderableTracks) {
        checkCancel();
        const vcaMultiplier = vcaMultiplierByTrackId.get(track.id) ?? 1;
        // Match live solo-in-place at the same topology point: closing the
        // strip's pre-fader tap also silences audio routed into this strip.
        const state = {
            gain: track.gain,
            pan: track.pan,
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
    return { trackStripsById, sendAutomationParamsByTrack, deviceEntriesByTrack };
}
