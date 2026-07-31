import { trackStore } from '#/modules/Arrangement/stores';
import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';
import {
    scheduleNote,
    getDrumKitDefByIndex,
    scheduleDrumKitNote,
    getSynthParamsFromDevices,
} from '#/modules/Synth/useCases';

import { audioEngine } from '../repositories/createWebAudioEngine';

import { startFaustNote } from './faustScheduler/startFaustNote';

type AuditionDeviceParameterValues = Record<string, number> & {
    kit?: number;
    kitId?: number;
};

type AuditionDevice = {
    id: string;
    type: string;
    parameterValues: AuditionDeviceParameterValues;
};

type AuditionTrack = {
    id: string;
    parentId?: string | null;
    devices: AuditionDevice[];
};

export function playAuditionNote(trackId: string, pitch: number, velocity: number = 100): () => void {
    const strip = audioEngine.ensureTrackStrip(trackId);
    const now = audioEngine.context.currentTime;

    const trackCandidates: AuditionTrack[] | undefined = trackStore.value?.tracks;
    const track = trackCandidates?.find((candidate) => candidate.id === trackId);
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
    let toasterParentTrack: AuditionTrack | undefined;
    if (track?.parentId) {
        const parentCandidates: AuditionTrack[] | undefined = trackStore.value?.tracks;
        toasterParentTrack = parentCandidates?.find((candidate) => candidate.id === track.parentId);
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

        const exactDeviceNode = parentStrip.deviceNodes.find((data) => data.deviceId === toasterDevice.id);
        const dn = exactDeviceNode ?? parentStrip.deviceNodes.find((data) => data.type === 'toaster');

        if (dn?.toasterControls?.ready) {
            let pad = pitch - 36;

            if (isToasterChild && toasterParentTrack) {
                const childCandidates: AuditionTrack[] | undefined = trackStore.value?.tracks;
                const children = childCandidates?.filter((time) => time.parentId === toasterParentTrack.id) || [];
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

    // Same instrument test the live scheduler and the offline chain builder use.
    // The `faust-` prefix is on every Faust module, so matching it auditioned the
    // note into the first Faust *effect* on the track — `startFaustNote` writes
    // freq/gain/gate params a reverb has no address for — and the early return
    // below then skipped the builtin-synth fallback, so the preview was silent.
    const faustDevice = track?.devices.find((data) => isFaustInstrumentModule(data.type));
    if (faustDevice) {
        return startFaustNote(trackId, faustDevice.id, pitch, velocity, now);
    }

    const synthParams = getSynthParamsFromDevices(track?.devices ?? []);
    const osc = scheduleNote(audioEngine.context, strip.gainNode, pitch, now, 60, velocity, synthParams);

    return () => {
        const killTime = audioEngine.context.currentTime;
        const releaseTime = synthParams.release;
        // scheduleNote always attaches the amplitude envelope, so apply the
        // exponential smooth release (no hard cutoff) before stopping.
        osc._env.gain.cancelScheduledValues(killTime);
        osc._env.gain.setTargetAtTime(0, killTime, releaseTime / 3);
        try {
            osc.stop(killTime + releaseTime + 0.05);
        } catch {
            /* already stopped */
        }
    };
}
