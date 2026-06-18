import { type Track } from '#/modules/Arrangement/models/Track';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    scheduleNote,
    getDrumKitDefByIndex,
    scheduleDrumKitNote,
    getSynthParamsFromDevices,
} from '#/modules/Synth/useCases';

import { audioEngine } from '../repositories/createWebAudioEngine';

import { startFaustNote } from './faustScheduler/startFaustNote';

export function playAuditionNote(trackId: string, pitch: number, velocity: number = 100): () => void {
    const strip = audioEngine.ensureTrackStrip(trackId);
    const now = audioEngine.context.currentTime;

    const track = trackStore.value?.tracks.find((t) => t.id === trackId);
    const drumDevice = track?.devices.find(
        (data) =>
            data.type === 'builtin-drum-kit' || data.type === 'drum-kit' || data.type.startsWith('builtin-drum-machine')
    );

    if (drumDevice) {
        const kitIndex = drumDevice.parameterValues.kit ?? drumDevice.parameterValues.kitId ?? 0;
        const kitDef = getDrumKitDefByIndex(kitIndex);
        if (kitDef) {
            scheduleDrumKitNote(audioEngine.context, strip.gainNode, kitDef, pitch, now, velocity);
        }
        return () => {};
    }

    const fermenterDevice = track?.devices.find((data) => data.type === 'fermenter');
    if (fermenterDevice) {
        const dn = strip.deviceNodes.find((data) => data.deviceId === fermenterDevice.id || data.type === 'fermenter');
        if (dn?.fermenterControls?.ready) {
            dn.fermenterControls.noteOn(pitch, velocity);
            return () => {
                dn.fermenterControls?.noteOff(pitch);
            };
        }
        return () => {};
    }

    let isToasterChild = false;
    let toasterParentTrack: Track | undefined;
    if (track?.parentId) {
        toasterParentTrack = trackStore.value?.tracks.find((candidate) => candidate.id === track.parentId);
        if (toasterParentTrack?.devices.some((data) => data.type === 'toaster')) {
            isToasterChild = true;
        }
    }

    const toasterDevice =
        track?.devices.find((data) => data.type === 'toaster') ||
        toasterParentTrack?.devices.find((data) => data.type === 'toaster');

    if (toasterDevice) {
        const effectiveTrackId = toasterParentTrack ? toasterParentTrack.id : trackId;
        const parentStrip = audioEngine.ensureTrackStrip(effectiveTrackId);

        const dn = parentStrip.deviceNodes.find(
            (data) => data.deviceId === toasterDevice.id || data.type === 'toaster'
        );

        if (dn?.toasterControls?.ready) {
            let pad = pitch - 36;

            if (isToasterChild && toasterParentTrack) {
                const children =
                    trackStore.value?.tracks.filter((time) => time.parentId === toasterParentTrack.id) || [];
                const childPad = children.findIndex((time) => time.id === trackId);
                if (childPad !== -1) {
                    pad = childPad;
                }
            }

            dn.toasterControls.noteOn(pad, velocity ?? 100, pitch);
            return () => {
                dn.toasterControls?.noteOff(pad);
            };
        }
        return () => {};
    }

    const grandBouleDevice = track?.devices.find((data) => data.type === 'grand-boule');
    if (grandBouleDevice) {
        const dn = strip.deviceNodes.find(
            (data) => data.deviceId === grandBouleDevice.id || data.type === 'grand-boule'
        );
        if (dn?.grandBouleControls?.ready) {
            dn.grandBouleControls.noteOn(pitch, velocity / 127);
            return () => {
                dn.grandBouleControls?.noteOff(pitch);
            };
        }
        return () => {};
    }

    const levainDevice = track?.devices.find((data) => data.type === 'levain');
    if (levainDevice) {
        const dn = strip.deviceNodes.find((data) => data.deviceId === levainDevice.id || data.type === 'levain');
        if (dn?.levainControls?.ready) {
            dn.levainControls.noteOn(pitch, velocity);
            return () => {
                dn.levainControls?.noteOff(pitch);
            };
        }
    }

    const faustDevice = track?.devices.find((data) => data.type.startsWith('faust-'));
    if (faustDevice) {
        return startFaustNote(trackId, faustDevice.id, pitch, velocity, now);
    }

    const synthParams = getSynthParamsFromDevices(track?.devices ?? []);
    const osc = scheduleNote(
        audioEngine.context,
        strip.gainNode,
        pitch,
        now,
        60,
        velocity,
        synthParams
    ) as OscillatorNode & { _env?: GainNode };

    return () => {
        const killTime = audioEngine.context.currentTime;
        const releaseTime = synthParams?.release ?? 0.3;
        if (osc._env) {
            osc._env.gain.cancelScheduledValues(killTime);
            osc._env.gain.setTargetAtTime(0, killTime, releaseTime / 3);
        }
        try {
            osc.stop(killTime + releaseTime + 0.05);
        } catch {
            /* already stopped */
        }
    };
}
