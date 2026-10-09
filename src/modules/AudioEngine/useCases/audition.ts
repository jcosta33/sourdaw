import { trackStore } from '#/modules/Arrangement/stores';
import {
    scheduleNote,
    getDrumKitDefByIndex,
    scheduleDrumKitNote,
    scheduleKitNote,
    getSynthParamsFromDevices,
} from '#/modules/Synth/useCases';

import { audioEngine } from '../repositories/createWebAudioEngine';

import { getDrumKitByIndex } from './audioEngineQueries/getDrumKitByIndex';
import { startFaustNote } from './faustScheduler/startFaustNote';
import { resolveAuditionNoteReceiver } from './resolveAuditionNoteReceiver';

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
    const parentId = track?.parentId;
    const parentTrack = trackCandidates?.find((candidate) => Boolean(parentId) && candidate.id === parentId);
    const toasterParentTrack = parentTrack?.devices.some((data) => data.type === 'toaster') ? parentTrack : undefined;
    // The note reaches the receiving instrument playback, export and live input
    // voice; each branch below only delivers to it.
    const receiver = resolveAuditionNoteReceiver(
        toasterParentTrack?.devices ?? track?.devices ?? [],
        toasterParentTrack !== undefined
    );
    const receivingDevice = receiver?.device;

    if (receiver?.kind === 'drum') {
        const drumDevice = receiver.device;
        const kitIndex = drumDevice.parameterValues.kit ?? drumDevice.parameterValues.kitId ?? 0;
        const kitDef = getDrumKitDefByIndex(kitIndex);
        if (kitDef) {
            scheduleDrumKitNote(audioEngine.context, strip.gainNode, kitDef, pitch, now, velocity);
            return () => {};
        }

        // The dedicated kit definitions cover only the 808, so the remaining
        // declared kit selections (Analog … Trap) resolve through the factory
        // kit table — the same fallback the hardware MIDI path uses. Return
        // without dispatching only when nothing declares the index.
        const kit = getDrumKitByIndex(kitIndex);
        if (!kit) {
            return () => {};
        }

        const osc: (OscillatorNode & { _env?: GainNode }) | null = scheduleKitNote(
            audioEngine.context,
            strip.gainNode,
            kit,
            pitch,
            now,
            60,
            velocity
        );
        if (!osc) {
            return () => {};
        }

        const releaseTime = getSynthParamsFromDevices(track?.devices ?? []).release;
        return () => {
            const killTime = audioEngine.context.currentTime;
            // scheduleKitNote schedules through the builtin synth, which always
            // attaches the amplitude envelope, so apply the exponential smooth
            // release (no hard cutoff) before stopping.
            osc._env?.gain.cancelScheduledValues(killTime);
            osc._env?.gain.setTargetAtTime(0, killTime, releaseTime / 3);
            try {
                osc.stop(killTime + releaseTime + 0.05);
            } catch {
                /* already stopped */
            }
        };
    }

    if (receivingDevice?.type === 'fermenter') {
        const fermenterDevice = receivingDevice;
        const dn = strip.deviceNodes.find((data) => data.deviceId === fermenterDevice.id || data.type === 'fermenter');
        if (dn?.fermenterControls?.ready) {
            dn.fermenterControls.noteOn(pitch, velocity);
            return () => {
                dn.fermenterControls?.noteOff(pitch);
            };
        }
        return () => {};
    }

    if (receiver?.kind === 'toaster') {
        const toasterDevice = receiver.device;
        const effectiveTrackId = toasterParentTrack ? toasterParentTrack.id : trackId;
        const parentStrip = audioEngine.ensureTrackStrip(effectiveTrackId);

        const exactDeviceNode = parentStrip.deviceNodes.find((data) => data.deviceId === toasterDevice.id);
        const dn = exactDeviceNode ?? parentStrip.deviceNodes.find((data) => data.type === 'toaster');

        if (dn?.toasterControls?.ready) {
            let pad = pitch - 36;

            if (toasterParentTrack) {
                const children = trackCandidates?.filter((time) => time.parentId === toasterParentTrack.id) || [];
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

    if (receivingDevice?.type === 'grand-boule') {
        const grandBouleDevice = receivingDevice;
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

    if (receivingDevice?.type === 'levain') {
        const levainDevice = receivingDevice;
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
    if (receiver?.kind === 'faust') {
        return startFaustNote(trackId, receiver.device.id, pitch, velocity, now);
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
