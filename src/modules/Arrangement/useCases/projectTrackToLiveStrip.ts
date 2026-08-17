import {
    addDeviceToStrip,
    ensureTrackStrip,
    reportLatency,
    resolveToasterPadBinding,
    setTrackGain,
    setTrackOutput,
    setTrackPan,
    updateDeviceBypass,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin } from '#/modules/PluginHost/useCases';
import { setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';

import { resolveEligibleDeviceWriteTarget } from '../stores/resolveEligibleDeviceWriteTarget';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../stores/trackEligibility';
import { trackStore } from '../stores/trackStore';

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

    ensureTrackStrip(track.id);
    if (acceptsRoutingEndpoint(tracks, track.outputId)) {
        const padBinding = resolveToasterPadBinding(tracks, track.id);
        if (padBinding) {
            setTrackOutput(track.id, track.outputId, padBinding);
        } else {
            setTrackOutput(track.id, track.outputId);
        }
    }
    setTrackGain(track.id, track.gain);
    setTrackPan(track.id, track.pan);
    applySoloLogic({ trackId: track.id });

    const audioDevices = track.devices.filter((device) => device.type !== 'yeast');
    for (const [deviceIndex, device] of audioDevices.entries()) {
        const target = resolveEligibleDeviceWriteTarget(device.id);
        if (target.status !== 'eligible' || target.trackId !== track.id) {
            continue;
        }
        let instanceId: string | undefined;
        if (activateDormantExternalPlugins && device.type === 'external-plugin' && device.externalInstanceId) {
            instanceId = device.externalInstanceId;
        }
        const precedingDeviceIds = audioDevices.slice(0, deviceIndex).map((candidate) => candidate.id);
        const parameterIds = Object.keys(device.parameterValues).sort((left, right) => left.localeCompare(right));
        addDeviceToStrip(target.trackId, target.deviceId, device.type, instanceId, precedingDeviceIds, parameterIds);
        const pluginId = device.externalPluginId;
        if (instanceId && pluginId) {
            // Idempotent load + state restore; skips if the instance is already live,
            // so the project-open rebuild and every Play/record rebuild stay cheap.
            activateExternalPlugin({
                pluginId,
                instanceId,
                stateChunk: device.externalStateChunk,
                onLatencyMs: (latencyMs) => reportLatency(target.deviceId, latencyMs),
            });
        }
        for (const [parameterId, value] of Object.entries(device.parameterValues)) {
            if (typeof value === 'number') {
                updateDeviceParam(target.trackId, target.deviceId, parameterId, value);
            }
        }
        updateDeviceBypass(target.trackId, target.deviceId, device.bypassed);
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
