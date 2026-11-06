/**
 * The built-in synth and drum synth voices note scheduling sounds a note
 * through. The Synth device owns the voices; AudioEngine declares the shapes
 * it schedules them with, structurally equal to Synth's own, so the engine and
 * the core modules that schedule notes never import the device.
 */

import { type DrumKit, type SynthParams } from './SynthModels';

/** Per-note MPE expression a built-in synth voice sounds. */
export type BuiltinSynthMpe = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /** Semitone range `pitchBend` is expressed in, resolved by the caller. */
    pitchBendRangeSemitones?: number;
};

export type BuiltinDrumVoiceType =
    | 'kick'
    | 'snare'
    | 'clap'
    | 'closed-hh'
    | 'open-hh'
    | 'tom-low'
    | 'tom-mid'
    | 'tom-high'
    | 'cowbell'
    | 'rimshot'
    | 'conga-low'
    | 'conga-mid'
    | 'conga-high'
    | 'maracas'
    | 'clave';

/** A synthesized drum kit: each MIDI note sounds one analog drum voice. */
export type BuiltinDrumKitDef = {
    id: string;
    name: string;
    voices: { name: string; midiNote: number; type: BuiltinDrumVoiceType }[];
};

export type BuiltinSynthVoice = {
    /** Schedule one live built-in synth note; the returned oscillator carries its amplitude envelope. */
    scheduleNote: (
        ctx: BaseAudioContext,
        destination: AudioNode,
        pitch: number,
        startTime: number,
        duration: number,
        velocity: number,
        params: SynthParams,
        mpe?: BuiltinSynthMpe,
        clipGain?: number
    ) => OscillatorNode & { _env: GainNode };
    /** Schedule one built-in synth note into an offline render. */
    scheduleNoteOffline: (
        ctx: BaseAudioContext,
        destination: AudioNode,
        pitch: number,
        startTime: number,
        duration: number,
        velocity: number,
        params: SynthParams,
        mpe?: BuiltinSynthMpe,
        clipGain?: number
    ) => void;
    /** Schedule one hit of a factory kit as a built-in synth voice; `null` when no voice covers the pitch. */
    scheduleKitNote: (
        ctx: BaseAudioContext,
        destination: AudioNode,
        kit: DrumKit,
        pitch: number,
        startTime: number,
        duration: number,
        velocity: number,
        clipGain: number,
        kitGain: number
    ) => OscillatorNode | null;
    /** Schedule one hit of a synthesized drum kit. */
    scheduleDrumKitNote: (
        ctx: BaseAudioContext,
        destination: AudioNode,
        kit: BuiltinDrumKitDef,
        midiNote: number,
        startTime: number,
        velocity: number,
        clipGain: number,
        kitGain: number
    ) => void;
    /** The synthesized drum kit a drum device's kit index selects, or `null`. */
    getDrumKitDefByIndex: (index: number) => BuiltinDrumKitDef | null;
    /** The built-in synth parameters a device chain plays, defaults when it holds no built-in synth. */
    getSynthParamsFromDevices: (devices: { type: string; parameterValues: Record<string, number> }[]) => SynthParams;
};
