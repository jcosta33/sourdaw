import { logger } from '#/infra/logger/appLogger';
import {
    getLiveEngineSampleRate,
    initializeTrackStripFromSnapshot,
    reportLatency,
    setTrackGain,
    setTrackPan,
    updateDeviceBypass,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin } from '#/modules/PluginHost/useCases';
import { setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';

import { resolveEligibleDeviceWriteTarget } from '../stores/resolveEligibleDeviceWriteTarget';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../stores/trackEligibility';
import { trackStore } from '../stores/trackStore';

import { compileTrackStripInitializationSnapshot } from './compileTrackStripInitializationSnapshot';
import { applySoloLogic } from './toggleTrackState/applySoloLogic';

import type { Track } from '../stores/trackStore';

type ProjectTrackToLiveStripInput = {
    trackId: string;
    deferSidechainWiring?: boolean;
    activateDormantExternalPlugins?: boolean;
    onExternalPluginActivation?: (activation: ReturnType<typeof activateExternalPlugin>) => void;
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
    onExternalPluginActivation,
}: ProjectTrackToLiveStripInput): ReturnType<typeof initializeTrackStripFromSnapshot> | undefined {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return undefined;
    }
    const track = findUniqueTrack(tracks, trackId);
    if (!track || !shouldCreateLiveTrackStrip(track)) {
        return undefined;
    }

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
        let instanceId: string | undefined;
        if (activateDormantExternalPlugins && device.type === 'external-plugin' && device.externalInstanceId) {
            instanceId = device.externalInstanceId;
        }
        const pluginId = device.externalPluginId;
        // The live engine's own rate: the plugin is fed audio this engine
        // renders, so it has to run on the same clock. Absent when the engine
        // is on its silent fallback shim, and this projection is the rebuild
        // path — it says so and leaves the plugin dormant, which is what the
        // next rebuild reverses. Activating on a substituted rate would not be
        // reversible: the instance stays detuned until something unloads it.
        const engineSampleRate = getLiveEngineSampleRate();
        if (instanceId && pluginId) {
            if (engineSampleRate === undefined) {
                logger.warn(
                    `Leaving external plugin ${instanceId} dormant on track ${track.id}: the audio engine is not rendering audio, so there is no sample rate to activate at`
                );
            } else {
                // Idempotent load + state restore; skips if the instance is already live,
                // so the project-open rebuild and every Play/record rebuild stay cheap.
                const activation = activateExternalPlugin({
                    pluginId,
                    instanceId,
                    stateChunk: device.externalStateChunk,
                    engineSampleRate,
                    onLatencyMs: (latencyMs) => reportLatency(device.id, latencyMs),
                });
                onExternalPluginActivation?.(activation);
            }
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
    return initialization;
}
