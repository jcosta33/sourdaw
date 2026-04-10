/**
 * Ensures all track and bus strips exist in the audio engine
 * and syncs their gain/pan/mute/solo/sends/devices from the store state.
 *
 * Used by startPlayback and toggleRecording before audio begins.
 */

import { inject } from '#/infra/di/inject';
import { trackStore } from '#/modules/Arrangement';
import {
    addDeviceToStrip,
    ensureTrackStrip,
    setTrackGain,
    setTrackMute,
    setTrackOutput,
    setTrackPan,
    updateDeviceParam,
} from '#/modules/AudioEngine';
import { ensureBusStrip, setBusGain, setSend } from '#/modules/Routing';

export const ensureTrackStrips = inject(
    {
        get trackStore() {
            return trackStore;
        },
        get ensureTrackStrip() {
            return ensureTrackStrip;
        },
        get setTrackGain() {
            return setTrackGain;
        },
        get setTrackPan() {
            return setTrackPan;
        },
        get setTrackMute() {
            return setTrackMute;
        },
        get setTrackOutput() {
            return setTrackOutput;
        },
        get addDeviceToStrip() {
            return addDeviceToStrip;
        },
        get updateDeviceParam() {
            return updateDeviceParam;
        },
        get ensureBusStrip() {
            return ensureBusStrip;
        },
        get setBusGain() {
            return setBusGain;
        },
        get setSend() {
            return setSend;
        },
    },
    { lazy: true }
)(
    ({
        trackStore,
        ensureTrackStrip,
        setTrackGain,
        setTrackPan,
        setTrackMute,
        setTrackOutput,
        addDeviceToStrip,
        updateDeviceParam,
        ensureBusStrip,
        setBusGain,
        setSend,
    }) =>
        function ensureTrackStrips(): void {
            const tracks = trackStore.value?.tracks;
            if (!tracks) {
                return;
            }
            const busTracks = tracks.filter((t) => t.kind === 'bus');
            for (const bus of busTracks) {
                ensureBusStrip(bus.id);
                setBusGain(bus.id, bus.gain);
            }

            for (const track of tracks) {
                if (track.kind === 'folder') {
                    continue;
                }
                ensureTrackStrip(track.id);
                setTrackOutput(track.id, track.outputId);
                setTrackGain(track.id, track.gain);
                setTrackPan(track.id, track.pan);
                setTrackMute(track.id, track.muted, track.gain);

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
                    setSend(track.id, send.busId, send.level, send.preFader);
                }
            }

            // Apply solo state: if any track is soloed, mute all non-soloed tracks.
            // This ensures solo set before pressing play takes effect immediately.
            const anySoloed = tracks.some((t) => t.soloed && t.kind !== 'folder');
            if (anySoloed) {
                for (const track of tracks) {
                    if (track.kind === 'folder' || track.kind === 'master') {
                        continue;
                    }
                    const shouldMute = !track.soloed;
                    setTrackMute(track.id, shouldMute || track.muted, track.gain);
                }
            }
        }
);
