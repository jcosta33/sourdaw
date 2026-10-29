import {
    initializeTrackStripFromSnapshot,
    reportLatency,
    setTrackGain,
    setTrackPan,
    updateDeviceBypass,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin } from '#/modules/PluginHost/useCases';
import { getAllSidechainRoutes, setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';
import { orderDeviceParametersForReplay } from '#/utils/devicePatchPrecedence';
import { getSidechainTargetCapability } from '#/utils/getSidechainTargetCapability';
import { hasRoutingCycle } from '#/utils/routingCycle';

import { resolveEligibleDeviceWriteTarget } from '../stores/resolveEligibleDeviceWriteTarget';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../stores/trackEligibility';
import { trackStore } from '../stores/trackStore';

import { compileTrackStripInitializationSnapshot } from './compileTrackStripInitializationSnapshot';
import { applySoloLogic } from './toggleTrackState/applySoloLogic';

import type { Device, Track } from '../stores/trackStore';

type ProjectTrackToLiveStripInput = {
    mode?: 'strip';
    trackId: string;
    deferSidechainWiring?: boolean;
    deferSends?: boolean;
    activateDormantExternalPlugins?: boolean;
    onExternalPluginActivation?: (activation: ReturnType<typeof activateExternalPlugin>) => void;
};

type ProjectDeviceControlsInput = {
    mode: 'device-controls';
    trackId: string;
    deviceId: string;
    activateDormantExternalPlugins?: boolean;
    onExternalPluginActivation?: ProjectTrackToLiveStripInput['onExternalPluginActivation'];
};

type ProjectTrackSendsInput = {
    mode: 'sends';
    trackId: string;
};

type ProjectTrackSendsResult = { status: 'projected' } | { status: 'rejected'; reason: string };

type ReplayDeviceToLiveStripInput = {
    trackId: string;
    device: Device;
    activateDormantExternalPlugins?: boolean;
    onExternalPluginActivation?: ProjectTrackToLiveStripInput['onExternalPluginActivation'];
};

// Callers admit the owning device before replay, either with the whole strip's
// captured devices or the final committed device after a grouped Undo.
function replayDeviceToLiveStrip({
    trackId,
    device,
    activateDormantExternalPlugins = false,
    onExternalPluginActivation,
}: ReplayDeviceToLiveStripInput): void {
    let instanceId: string | undefined;
    if (activateDormantExternalPlugins && device.type === 'external-plugin' && device.externalInstanceId) {
        instanceId = device.externalInstanceId;
    }
    const pluginId = device.externalPluginId;
    if (instanceId && pluginId) {
        // Idempotent load + state restore; skips if the instance is already live,
        // so the project-open rebuild and every Play/record rebuild stay cheap.
        // The native engine activates it at its own negotiated rate.
        const activation = activateExternalPlugin({
            pluginId,
            instanceId,
            stateChunk: device.externalStateChunk,
            onLatencyMs: (latencyMs) => reportLatency(device.id, latencyMs),
        });
        onExternalPluginActivation?.(activation);
    }
    for (const [parameterId, value] of orderDeviceParametersForReplay(device.type, device.parameterValues)) {
        if (typeof value === 'number') {
            updateDeviceParam(trackId, device.id, parameterId, value);
        }
    }
    updateDeviceBypass(trackId, device.id, device.bypassed);
}

type TrackOwners = ReadonlyMap<string, Track | null>;

function indexTrackOwners(tracks: readonly Track[]): TrackOwners {
    const owners = new Map<string, Track | null>();
    for (const track of tracks) {
        owners.set(track.id, owners.has(track.id) ? null : track);
    }
    return owners;
}

function acceptsRoutingEndpoint(owners: TrackOwners, targetId: string): boolean {
    const target = owners.get(targetId);
    if (target === undefined) {
        return true;
    }
    return target ? getTrackEligibility(target.kind).acceptsRoutingEndpoint : false;
}

function replayTrackSends(track: Track, owners: TrackOwners): void {
    for (const send of track.sends) {
        if (acceptsRoutingEndpoint(owners, send.busId)) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
}

function hasPersistedLiveRoutingCycle(tracks: readonly Track[], owners: TrackOwners): boolean {
    const liveTracks = tracks.filter((track) => shouldCreateLiveTrackStrip(track) && owners.get(track.id) === track);
    const liveIds = new Set(liveTracks.map((track) => track.id));
    const sidechainTargets = new Map<string, Set<string>>();
    for (const track of liveTracks) {
        const deviceIds = new Set<string>();
        for (const device of track.devices) {
            if (getSidechainTargetCapability(device.type)) {
                deviceIds.add(device.id);
            }
        }
        sidechainTargets.set(track.id, deviceIds);
    }
    return hasRoutingCycle({
        tracks: liveTracks.map((track) => ({
            id: track.id,
            // These output ids address engine terminals, even if a project row
            // happens to share their name. Dormant rows never replay their edges.
            outputId:
                track.outputId !== 'master' &&
                track.outputId !== 'hw_out' &&
                acceptsRoutingEndpoint(owners, track.outputId)
                    ? track.outputId
                    : undefined,
            sends: track.sends.filter((send) => acceptsRoutingEndpoint(owners, send.busId)),
        })),
        // The engine drops orphan and unsupported detector targets. Their saved
        // metadata is retained, but it contributes no replayed sidechain edge.
        sidechainRoutes: getAllSidechainRoutes().filter(
            (route) =>
                liveIds.has(route.sourceTrackId) &&
                sidechainTargets.get(route.targetTrackId)?.has(route.targetDeviceId) === true
        ),
    });
}

export function projectTrackToLiveStrip(input: ProjectTrackSendsInput): ProjectTrackSendsResult;
export function projectTrackToLiveStrip(input: ProjectDeviceControlsInput): void;
export function projectTrackToLiveStrip(
    input: ProjectTrackToLiveStripInput
): ReturnType<typeof initializeTrackStripFromSnapshot> | undefined;
export function projectTrackToLiveStrip(
    input: ProjectTrackToLiveStripInput | ProjectDeviceControlsInput | ProjectTrackSendsInput
): ReturnType<typeof initializeTrackStripFromSnapshot> | ProjectTrackSendsResult | undefined {
    const { trackId } = input;
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        if (input.mode === 'sends') {
            return { status: 'rejected', reason: 'Project tracks are unavailable' };
        }
        return undefined;
    }
    const owners = indexTrackOwners(tracks);
    const track = owners.get(trackId);
    if (!track || !shouldCreateLiveTrackStrip(track)) {
        if (input.mode === 'sends') {
            return { status: 'rejected', reason: `Track ${trackId} has no unique eligible routing owner` };
        }
        return undefined;
    }
    // Check the complete admitted relation before the first strip can publish
    // an output, and again before sends-only replay. Stored snapshots can carry
    // cycles that the output/send/sidechain mutation guards would reject.
    if (input.mode !== 'device-controls' && hasPersistedLiveRoutingCycle(tracks, owners)) {
        const reason = 'Persisted live routing contains a routing cycle';
        if (input.mode === 'sends') {
            return { status: 'rejected', reason };
        }
        return { acceptance: 'rejected', application: 'not-applied', reason };
    }
    if (input.mode === 'sends') {
        replayTrackSends(track, owners);
        return { status: 'projected' };
    }
    const { activateDormantExternalPlugins = false, onExternalPluginActivation } = input;

    if (input.mode === 'device-controls') {
        const target = resolveEligibleDeviceWriteTarget(input.deviceId);
        const device = track.devices.find((candidate) => candidate.id === input.deviceId);
        if (
            target.status !== 'eligible' ||
            target.trackId !== track.id ||
            target.deviceId !== input.deviceId ||
            !device
        ) {
            return undefined;
        }
        replayDeviceToLiveStrip({ trackId, device, activateDormantExternalPlugins, onExternalPluginActivation });
        return undefined;
    }
    const { deferSidechainWiring = false, deferSends = false } = input;

    const audioDevices = track.devices.filter((device) => device.type !== 'yeast');
    for (const device of audioDevices) {
        const target = resolveEligibleDeviceWriteTarget(device.id);
        if (target.status !== 'eligible' || target.trackId !== track.id || target.deviceId !== device.id) {
            return undefined;
        }
    }
    if (!acceptsRoutingEndpoint(owners, track.outputId)) {
        return undefined;
    }
    const snapshot = compileTrackStripInitializationSnapshot(track, tracks);
    if (!snapshot) {
        return undefined;
    }
    const initialization = initializeTrackStripFromSnapshot(snapshot);
    if (initialization.acceptance === 'rejected' || initialization.application === 'needs-reconcile') {
        return initialization;
    }

    setTrackGain(track.id, track.gain);
    setTrackPan(track.id, track.pan);
    applySoloLogic({ trackId: track.id });

    for (const device of audioDevices) {
        replayDeviceToLiveStrip({
            trackId: track.id,
            device,
            activateDormantExternalPlugins,
            onExternalPluginActivation,
        });
    }

    if (!deferSends) {
        replayTrackSends(track, owners);
    }
    if (!deferSidechainWiring) {
        wireSidechainRoutes();
    }
    return initialization;
}
