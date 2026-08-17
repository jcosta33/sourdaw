import {
    getRuntimeGraphRevision,
    initializeTrackStripFromSnapshot,
    reportLatency,
    resolveToasterPadBinding,
    setTrackGain,
    setTrackPan,
    updateDeviceBypass,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { activateExternalPlugin } from '#/modules/PluginHost/useCases';
import { setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';

import { resolveEligibleDeviceWriteTarget } from '../stores/resolveEligibleDeviceWriteTarget';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../stores/trackEligibility';
import { trackStore } from '../stores/trackStore';

import { runtimeGraphTopology } from './runtimeGraphTopology';
import { applySoloLogic } from './toggleTrackState/applySoloLogic';

import type { Track } from '../stores/trackStore';

type ProjectTrackToLiveStripInput = {
    trackId: string;
    deferSidechainWiring?: boolean;
    activateDormantExternalPlugins?: boolean;
};

function findUniqueTrack(tracks: readonly Track[], trackId: string): Track | null {
    const matches = tracks.filter((track) => track.id === trackId);
    if (matches.length !== 1) {
        return null;
    }
    return matches[0] ?? null;
}

function acceptsRoutingEndpoint(tracks: readonly Track[], targetId: string): boolean {
    const matches = tracks.filter((track) => track.id === targetId);
    if (matches.length === 0) {
        return true;
    }
    if (matches.length !== 1) {
        return false;
    }
    const target = matches[0];
    return target ? getTrackEligibility(target.kind).acceptsRoutingEndpoint : false;
}

function createTrackStripInitializationSnapshot(
    track: Track,
    tracks: readonly Track[],
    padBinding: ReturnType<typeof resolveToasterPadBinding>
) {
    const source = runtimeGraphTopology.createNode(track);
    const targets =
        track.outputId === 'master' || track.outputId === 'hw_out'
            ? []
            : tracks.filter((candidate) => candidate.id === track.outputId);
    if (targets.length > 1 || (targets[0] && !getTrackEligibility(targets[0].kind).acceptsRoutingEndpoint)) {
        return null;
    }
    const target = targets[0];
    return {
        schemaVersion: 1,
        command: 'initialize-track-strip',
        correlation: {
            appRevision: getRuntimeGraphRevision(),
            projectRevision: captureProjectRevision(),
        },
        nodes: target ? [source, runtimeGraphTopology.createNode(target)] : [source],
        output: {
            kind: 'output',
            sourceId: track.id,
            targetId: track.outputId,
            ...(padBinding ? { padBinding } : {}),
        },
        parameters: [],
    };
}

export function projectTrackToLiveStrip({
    trackId,
    deferSidechainWiring = false,
    activateDormantExternalPlugins = false,
}: ProjectTrackToLiveStripInput): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    const track = findUniqueTrack(tracks, trackId);
    if (!track || !shouldCreateLiveTrackStrip(track)) {
        return;
    }

    const audioDevices = track.devices.filter((device) => device.type !== 'yeast');
    for (const device of audioDevices) {
        const target = resolveEligibleDeviceWriteTarget(device.id);
        if (target.status !== 'eligible' || target.trackId !== track.id || target.deviceId !== device.id) {
            return;
        }
    }
    if (!acceptsRoutingEndpoint(tracks, track.outputId)) {
        return;
    }
    const padBinding = resolveToasterPadBinding(tracks, track.id);
    const snapshot = createTrackStripInitializationSnapshot(track, tracks, padBinding);
    if (!snapshot) {
        return;
    }
    const initialization = initializeTrackStripFromSnapshot(snapshot);
    if (initialization.acceptance === 'rejected' || initialization.application === 'needs-reconcile') {
        return;
    }

    setTrackGain(track.id, track.gain);
    setTrackPan(track.id, track.pan);
    applySoloLogic({ trackId: track.id });

    for (const device of audioDevices) {
        let instanceId: string | undefined;
        if (activateDormantExternalPlugins && device.type === 'external-plugin' && device.externalInstanceId) {
            instanceId = device.externalInstanceId;
        }
        const pluginId = device.externalPluginId;
        if (instanceId && pluginId) {
            // Idempotent load + state restore; skips if the instance is already live,
            // so the project-open rebuild and every Play/record rebuild stay cheap.
            activateExternalPlugin({
                pluginId,
                instanceId,
                stateChunk: device.externalStateChunk,
                onLatencyMs: (latencyMs) => reportLatency(device.id, latencyMs),
            });
        }
        for (const [parameterId, value] of Object.entries(device.parameterValues)) {
            if (typeof value === 'number') {
                updateDeviceParam(track.id, device.id, parameterId, value);
            }
        }
        updateDeviceBypass(track.id, device.id, device.bypassed);
    }

    for (const send of track.sends) {
        if (acceptsRoutingEndpoint(tracks, send.busId)) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
    if (!deferSidechainWiring) {
        wireSidechainRoutes();
    }
}
