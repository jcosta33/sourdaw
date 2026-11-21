import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';

import { type AudioPreviewIntent } from '../models/AudioPreviewIntent';
import { readDrumKitOutputGain } from '../models/DrumKitSelection';
import { type LiveNoteControls, resolveLiveNoteControls } from '../models/LiveNoteControlsByDeviceType';
import { isBypassedNoteReceiver } from '../models/NoteReceivingInstrument';
import { audioEngine } from '../repositories/createWebAudioEngine';

import { getDrumKitByIndex } from './audioEngineQueries/getDrumKitByIndex';
import { startFaustNote } from './faustScheduler/startFaustNote';
import { resolveAuditionNoteReceiver } from './resolveAuditionNoteReceiver';
import { builtinSynthVoice } from './scheduling/builtinSynthVoice';

const AUDITION_CALLER = 'playAuditionNote';

type AuditionDeviceParameterValues = Record<string, number> & {
    kit?: number;
    kitId?: number;
};

type AuditionDevice = {
    id: string;
    type: string;
    bypassed?: boolean;
    parameterValues: AuditionDeviceParameterValues;
};

type AuditionTrack = {
    id: string;
    parentId?: string | null;
    devices: AuditionDevice[];
};

export function playAuditionNote(
    trackId: string,
    pitch: number,
    velocity: number = 100,
    parentIntent?: AudioPreviewIntent
): () => void {
    const intent = parentIntent ?? audioEngine.beginAudioPreviewIntent();
    let ended = false;
    let stopNote: (() => void) | null = null;
    const stop = () => {
        if (ended) {
            return;
        }
        ended = true;
        intent.signal.removeEventListener('abort', stop);
        try {
            stopNote?.();
        } finally {
            if (parentIntent === undefined) {
                intent.release();
            }
        }
    };
    intent.signal.addEventListener('abort', stop, { once: true });
    const start = () => {
        if (ended || !intent.isCurrent()) {
            stop();
            return;
        }
        stopNote = startAuditionNote(trackId, pitch, velocity);
        if (!intent.isCurrent()) {
            stop();
        }
    };
    try {
        if (intent.ready === undefined) {
            start();
        } else {
            void intent.ready.then(start).catch((error: unknown) => {
                stop();
                logger.warn(new Error('Note audition could not restore its listening output', { cause: error }));
            });
        }
    } catch (error) {
        stop();
        throw error;
    }
    return stop;
}

/**
 * Sound one preview note on a worklet instrument's node: the receiver's own, or
 * the first node of its type when the receiver's is not built. Returns the
 * release, or null when that node is not ready.
 */
function startWorkletSynthAudition(
    target: Readonly<{
        strip: ReturnType<typeof audioEngine.ensureTrackStrip>;
        receivingDevice: AuditionDevice;
        liveNoteControls: LiveNoteControls;
    }>,
    pitch: number,
    velocity: number
): (() => void) | null {
    const { strip, receivingDevice, liveNoteControls } = target;
    const { controlsKey } = liveNoteControls;
    const dn = strip.deviceNodes.find(
        (data) => data.deviceId === receivingDevice.id || data.type === receivingDevice.type
    );
    const controls = dn?.[controlsKey];
    if (!dn || !controls?.ready) {
        return null;
    }
    controls.noteOn(pitch, liveNoteControls.scaleVelocity(velocity));
    return () => {
        dn[controlsKey]?.noteOff(pitch);
    };
}

function startAuditionNote(trackId: string, pitch: number, velocity: number): () => void {
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

    if (isBypassedNoteReceiver(receiver)) {
        return () => {};
    }

    if (receiver?.kind === 'drum') {
        const drumDevice = receiver.device;
        const kitIndex = drumDevice.parameterValues.kit ?? drumDevice.parameterValues.kitId ?? 0;
        const kitGain = readDrumKitOutputGain(drumDevice);
        const voice = builtinSynthVoice.read(AUDITION_CALLER);
        const kitDef = voice.getDrumKitDefByIndex(kitIndex);
        if (kitDef) {
            voice.scheduleDrumKitNote(audioEngine.context, strip.gainNode, kitDef, pitch, now, velocity, 1, kitGain);
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

        const osc: (OscillatorNode & { _env?: GainNode }) | null = voice.scheduleKitNote(
            audioEngine.context,
            strip.gainNode,
            kit,
            pitch,
            now,
            60,
            velocity,
            1,
            kitGain
        );
        if (!osc) {
            return () => {};
        }

        const releaseTime = voice.getSynthParamsFromDevices(track?.devices ?? []).release;
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

    const liveNoteControls = receivingDevice ? resolveLiveNoteControls(receivingDevice.type) : null;
    if (receivingDevice && liveNoteControls) {
        const stopWorkletNote = startWorkletSynthAudition(
            { strip, receivingDevice, liveNoteControls },
            pitch,
            velocity
        );
        if (stopWorkletNote) {
            return stopWorkletNote;
        }
        // A Levain whose node is not ready yet previews on the built-in synth
        // below; every other worklet instrument previews nothing until ready.
        if (liveNoteControls.controlsKey !== 'levainControls') {
            return () => {};
        }
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

    // Same instrument test the live scheduler and the offline chain builder use.
    // The `faust-` prefix is on every Faust module, so matching it auditioned the
    // note into the first Faust *effect* on the track — `startFaustNote` writes
    // freq/gain/gate params a reverb has no address for — and the early return
    // below then skipped the builtin-synth fallback, so the preview was silent.
    if (receiver?.kind === 'faust') {
        return startFaustNote(trackId, receiver.device.id, pitch, velocity, now);
    }

    const voice = builtinSynthVoice.read(AUDITION_CALLER);
    const synthParams = voice.getSynthParamsFromDevices(track?.devices ?? []);
    const osc = voice.scheduleNote(audioEngine.context, strip.gainNode, pitch, now, 60, velocity, synthParams);

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
