import { getAllTracks } from '#/modules/Arrangement/useCases';
import {
    ensureTrackStrip,
    getAudioSampleRate,
    sendNativeLiveMidiControl,
    writeNativeBuiltinParameters,
} from '#/modules/AudioEngine/useCases';

import { GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES } from '../models/GrandBouleCalibrationDspParamNames';
import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../repositories/grandBouleEngineHandle';

/** The three pedals' controller numbers, as the wire carries them. */
const CC_SUSTAIN_PEDAL = 64;
const CC_SOSTENUTO_PEDAL = 66;
const CC_UNA_CORDA_PEDAL = 67;

/** Full scale for a 7-bit controller, which is also a switch's engaged value. */
const CONTROLLER_FULL_SCALE = 127;

/**
 * The channel a panel pedal is addressed on. A pedal belongs to the instrument
 * rather than to a voice and neither body consults the channel, so the base one
 * is where a message with no channel of its own belongs.
 */
const PEDAL_CHANNEL = 0;

type GrandBouleResolverDevice = {
    id: string;
};

type GrandBouleResolverTrack = {
    id: string;
    devices: readonly GrandBouleResolverDevice[];
};

type ResolveGrandBouleEngineInput = {
    deviceId: string;
    /**
     * Render-time callers pass the subscribed track list so
     * the React Compiler can memoize this derivation against the track
     * store. Non-render callers can omit this; we fall back to a live read.
     */
    tracks?: readonly GrandBouleResolverTrack[];
};

export type ResolvedGrandBouleEngine = GrandBouleEngineHandle;

export function resolveGrandBouleEngine(input: ResolveGrandBouleEngineInput): ResolvedGrandBouleEngine {
    const tracks = input.tracks ?? getAllTracks();
    const track = tracks.find((candidateTrack) =>
        candidateTrack.devices.some((device) => device.id === input.deviceId)
    );
    if (track === undefined) {
        return createDisconnectedGrandBouleEngineHandle();
    }

    const strip = ensureTrackStrip(track.id);
    // Scope to the addressed piano. `input.deviceId` located the owning track
    // above and was then discarded here, so on a track hosting two GrandBoules
    // the whole returned handle — noteOn, setParam, setSustain, loadAttackClip
    // — drove the first instance.
    const deviceNode = strip.deviceNodes.find(
        (candidateNode) => candidateNode.deviceId === input.deviceId && candidateNode.grandBouleControls?.ready
    );
    if (deviceNode?.grandBouleControls === undefined) {
        return createDisconnectedGrandBouleEngineHandle();
    }

    const controls = deviceNode.grandBouleControls;
    const engine: GrandBouleEngineHandle = {
        noteOn: (noteInput) => controls.noteOn(noteInput.midiNote, noteInput.velocity),
        noteOff: (noteInput) => controls.noteOff(noteInput.midiNote),
        noteOnMidi2: (noteInput) =>
            controls.noteOnMidi2(noteInput.midiNote, noteInput.velocity16bit, noteInput.pitchOffsetQ24),
        setParam: (paramInput) => controls.setParam(paramInput.name, paramInput.value),
        // Both carriers on every calibration write, the same reason the
        // pedals below take both: a native body (re)built at Play starts on
        // the DSP defaults, and a body already carried keeps whatever it was
        // last told, so a calibration that only reached the Web Audio node
        // would damp at a different pedal position depending on carrier.
        setCalibration: (calibrationInput) => {
            controls.setParam(
                GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.sustainThreshold,
                calibrationInput.sustainThreshold
            );
            controls.setParam(GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.ccSmoothingMs, calibrationInput.ccSmoothingMs);
            writeNativeBuiltinParameters(track.id, input.deviceId, {
                [GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.sustainThreshold]: calibrationInput.sustainThreshold,
                [GRAND_BOULE_CALIBRATION_DSP_PARAM_NAMES.ccSmoothingMs]: calibrationInput.ccSmoothingMs,
            });
        },
        // Both carriers on every pedal, exactly as a physical pedal reaches
        // both (`routePedalToBodies.ts`): the panel's own pedals are the same
        // foot, and a body that took only one half of a press stays latched
        // until something unrelated moves that pedal again.
        setSustain: (pedalInput) => {
            const wire = wirePosition(pedalInput.position);
            controls.setSustain(wire / CONTROLLER_FULL_SCALE);
            sendPedalToNativeBody(track.id, input.deviceId, CC_SUSTAIN_PEDAL, wire);
        },
        setUnaCorda: (pedalInput) => {
            controls.setUnaCorda(pedalInput.engaged);
            sendPedalToNativeBody(track.id, input.deviceId, CC_UNA_CORDA_PEDAL, wireSwitch(pedalInput.engaged));
        },
        setSostenuto: (pedalInput) => {
            controls.setSostenuto(pedalInput.engaged);
            sendPedalToNativeBody(track.id, input.deviceId, CC_SOSTENUTO_PEDAL, wireSwitch(pedalInput.engaged));
        },
        setTemperament: (temperamentInput) => controls.setTemperament(temperamentInput.index),
        loadAttackClip: (clipInput) => controls.loadAttackClip(clipInput.key, clipInput.samples),
        allNotesOff: () => controls.allNotesOff(),
        isReady: () => true,
        getAnalyserNode: () => strip.analyserNode,
        sampleRate: () => getAudioSampleRate(),
    };
    return engine;
}

/**
 * The `0..1` panel position as the wire carries it. The engine's body divides
 * CC64 by full scale itself, so a fraction sent raw would read as fully up.
 *
 * The quantization this applies is the only one either carrier gets: the Web
 * Audio node takes this value back over full scale rather than the raw
 * position, so both bodies read one damper. Both engage strictly above half
 * travel, and the panel's slider can reach exactly `0.50` — raw, that step
 * engaged the native body (`64/127`) and not the web one.
 */
function wirePosition(position: number): number {
    return Math.round(position * CONTROLLER_FULL_SCALE);
}

/** A switch pedal's two wire values, either side of the MIDI 64 threshold. */
function wireSwitch(engaged: boolean): number {
    return engaged ? CONTROLLER_FULL_SCALE : 0;
}

/**
 * Mirror one panel pedal movement onto the engine's own body.
 *
 * Fire and forget, through the one sanctioned controller route: it records the
 * movement whether or not a session holds a body for this device, so a pedal set
 * from the panel before play still reaches the body that play builds.
 */
function sendPedalToNativeBody(trackId: string, deviceId: string, controller: number, value: number): void {
    void sendNativeLiveMidiControl({ trackId, deviceId, controller, value, channel: PEDAL_CHANNEL });
}
