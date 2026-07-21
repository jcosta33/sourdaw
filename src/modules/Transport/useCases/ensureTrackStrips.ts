/**
 * Ensures all track and bus strips exist in the audio engine
 * and syncs their gain/pan/mute/solo/sends/devices from the store state.
 *
 * Used by startPlayback and toggleRecording before audio begins.
 */

import { getTrackEligibility, trackStore } from '#/modules/Arrangement/stores';
import {
    addDeviceToStrip,
    ensureTrackStrip,
    setTrackGain,
    setTrackMute,
    setTrackOutput,
    setTrackPan,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { ensureBusStrip, setBusGain, setSend, wireSidechainRoutes } from '#/modules/Routing/useCases';

export function ensureTrackStrips(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    const busTracks = tracks.filter((time) => time.kind === 'bus');
    for (const bus of busTracks) {
        ensureBusStrip(bus.id);
        setBusGain(bus.id, bus.gain);
    }

    for (const track of tracks) {
        if (!getTrackEligibility(track.kind).createsLiveStrip) {
            continue;
        }
        ensureTrackStrip(track.id);
        const outputTarget = tracks.find((candidate) => candidate.id === track.outputId);
        if (!outputTarget || getTrackEligibility(outputTarget.kind).acceptsRoutingEndpoint) {
            setTrackOutput(track.id, track.outputId);
        }
        setTrackGain(track.id, track.gain);
        setTrackPan(track.id, track.pan);
        setTrackMute(track.id, track.muted);

        // Bootstrap devices (effects & instruments) from the store data.
        // Without this, devices exist in the UI but have no audio nodes.
        for (const device of track.devices) {
            addDeviceToStrip(track.id, device.id, device.type);
            // Apply stored parameter values to the newly created audio nodes
            if (device.parameterValues) {
                for (const [paramId, value] of Object.entries(device.parameterValues)) {
                    if (typeof value === 'number') {
                        updateDeviceParam(track.id, device.id, paramId, value);
                    }
                }
            }
        }

        for (const send of track.sends) {
            const sendTarget = tracks.find((candidate) => candidate.id === send.busId);
            if (sendTarget && !getTrackEligibility(sendTarget.kind).acceptsRoutingEndpoint) {
                continue;
            }
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }

    // Re-wire persisted sidechain routes now that every track/bus strip and its
    // devices exist in the engine. Without this, a project saved with sidechain
    // routing loads with the routes in the store but never wired into the graph,
    // so the compression is silently absent. The engine ignores routes whose
    // target strip/device is missing, so this must run after the loop above.
    wireSidechainRoutes();
    // Apply solo state: if any track is soloed, mute all non-soloed tracks.
    // This ensures solo set before pressing play takes effect immediately.
    const anySoloed = tracks.some((time) => time.soloed && getTrackEligibility(time.kind).createsLiveStrip);
    if (anySoloed) {
        for (const track of tracks) {
            if (!getTrackEligibility(track.kind).createsLiveStrip || track.kind === 'master') {
                continue;
            }
            const shouldMute = !track.soloed;
            setTrackMute(track.id, shouldMute || track.muted);
        }
    }
}
