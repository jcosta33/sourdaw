import {
    initializeTrackStripFromSnapshot,
    reportLatency,
    setTrackGain,
    setTrackPan,
    updateDeviceBypass,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin } from '#/modules/PluginHost/useCases';
import { setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';
import { orderDeviceParametersForReplay } from '#/utils/devicePatchPrecedence';

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

export function projectTrackToLiveStrip(input: ProjectDeviceControlsInput): void;
export function projectTrackToLiveStrip(
    input: ProjectTrackToLiveStripInput
): ReturnType<typeof initializeTrackStripFromSnapshot> | undefined;
export function projectTrackToLiveStrip(
    input: ProjectTrackToLiveStripInput | ProjectDeviceControlsInput
): ReturnType<typeof initializeTrackStripFromSnapshot> | undefined {
    const { trackId, activateDormantExternalPlugins = false, onExternalPluginActivation } = input;
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return undefined;
    }
    const track = findUniqueTrack(tracks, trackId);
    if (!track || !shouldCreateLiveTrackStrip(track)) {
        return undefined;
    }

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
    const { deferSidechainWiring = false } = input;

    const audioDevices = track.devices.filter((device) => device.type !== 'yeast');
    for (const device of audioDevices) {
        const target = resolveEligibleDeviceWriteTarget(device.id);
        if (target.status !== 'eligible' || target.trackId !== track.id || target.deviceId !== device.id) {
            return undefined;
        }
    }
    if (!acceptsRoutingEndpoint(tracks, track.outputId)) {
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

    for (const send of track.sends) {
        if (acceptsRoutingEndpoint(tracks, send.busId)) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
    if (!deferSidechainWiring) {
        wireSidechainRoutes();
    }
    return initialization;
}
