import { trackStore } from "#/modules/Track/stores/trackStore";

export type SynthParams = {
    waveform: "sine" | "triangle" | "sawtooth" | "square";
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    filterCutoff: number;
    filterResonance: number;
    filterType: "lowpass" | "highpass" | "bandpass";
    detune: number;
    gain: number;
};

export const defaultSynthParams: SynthParams = {
    waveform: "sawtooth",
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5000,
    filterResonance: 1,
    filterType: "lowpass",
    detune: 0,
    gain: 0.3,
};

const SYNTH_PARAM_KEYS: ReadonlyArray<keyof SynthParams> = [
    "waveform",
    "attack",
    "decay",
    "sustain",
    "release",
    "filterCutoff",
    "filterResonance",
    "filterType",
    "detune",
    "gain",
];

const WAVEFORMS = new Set<string>(["sine", "triangle", "sawtooth", "square"]);
const FILTER_TYPES = new Set<string>(["lowpass", "highpass", "bandpass"]);

const WAVEFORM_INDEX: Record<number, SynthParams["waveform"]> = {
    0: "sine",
    1: "triangle",
    2: "sawtooth",
    3: "square",
};

const FILTER_TYPE_INDEX: Record<number, SynthParams["filterType"]> = {
    0: "lowpass",
    1: "highpass",
    2: "bandpass",
};

function resolveEnumParam<T extends string>(
    raw: number | string | undefined,
    allowed: Set<string>,
    indexMap: Record<number, T>,
    fallback: T,
): T {
    if (raw === undefined) {
        return fallback;
    }
    if (typeof raw === "string" && allowed.has(raw)) {
        return raw as T;
    }
    if (typeof raw === "number" && indexMap[raw] !== undefined) {
        return indexMap[raw];
    }
    return fallback;
}

export type MpeParams = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

const MPE_BEND_RANGE_SEMITONES = 48;

export const scheduleNote = (
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: SynthParams,
    mpe?: MpeParams,
): OscillatorNode => {
    const baseFrequency = 440 * Math.pow(2, (pitch - 69) / 12);
    const peakGain = (velocity / 127) * params.gain;
    const sustainLevel = peakGain * params.sustain;

    let frequency = baseFrequency;
    if (mpe?.pitchBend !== undefined) {
        const bendSemitones = (mpe.pitchBend / 8192) * MPE_BEND_RANGE_SEMITONES;
        frequency = baseFrequency * Math.pow(2, bendSemitones / 12);
    }

    const osc = ctx.createOscillator();
    osc.type = params.waveform;
    osc.frequency.setValueAtTime(frequency, startTime);
    osc.detune.value = params.detune;

    const filter = ctx.createBiquadFilter();
    filter.type = params.filterType;

    let filterCutoff = params.filterCutoff;
    if (mpe?.pressure !== undefined) {
        filterCutoff = params.filterCutoff + (mpe.pressure / 127) * 2000;
    }
    filter.frequency.setValueAtTime(filterCutoff, startTime);

    let filterQ = params.filterResonance;
    if (mpe?.slide !== undefined) {
        filterQ = (mpe.slide / 127) * 20;
    }
    filter.Q.setValueAtTime(filterQ, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, startTime);

    const attackEnd = startTime + params.attack;
    const decayEnd = attackEnd + params.decay;
    const releaseStart = startTime + duration;
    const releaseEnd = releaseStart + params.release;

    env.gain.linearRampToValueAtTime(peakGain, attackEnd);

    if (decayEnd < releaseStart) {
        env.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
        env.gain.setValueAtTime(sustainLevel, releaseStart);
    } else {
        env.gain.linearRampToValueAtTime(sustainLevel, releaseStart);
    }

    env.gain.linearRampToValueAtTime(0, releaseEnd);

    osc.connect(filter);
    filter.connect(env);
    env.connect(destination);

    osc.start(startTime);
    osc.stop(releaseEnd + 0.01);

    osc.onended = () => {
        filter.disconnect();
        env.disconnect();
    };

    return osc;
};

export const getSynthParamsForTrack = (trackId: string): SynthParams => {
    const state = trackStore.value;
    if (!state) {
        return { ...defaultSynthParams };
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return { ...defaultSynthParams };
    }

    const synthDevice = track.devices.find((d) => d.type === "synth" || d.type === "builtin-synth");
    if (!synthDevice) {
        return { ...defaultSynthParams };
    }

    const pv = synthDevice.parameterValues;
    const result: SynthParams = { ...defaultSynthParams };

    for (const key of SYNTH_PARAM_KEYS) {
        const raw = pv[key];
        if (raw === undefined) {
            continue;
        }

        if (key === "waveform") {
            result.waveform = resolveEnumParam(
                raw,
                WAVEFORMS,
                WAVEFORM_INDEX,
                defaultSynthParams.waveform,
            );
        } else if (key === "filterType") {
            result.filterType = resolveEnumParam(
                raw,
                FILTER_TYPES,
                FILTER_TYPE_INDEX,
                defaultSynthParams.filterType,
            );
        } else {
            (result as unknown as Record<string, number>)[key] = raw;
        }
    }

    return result;
};
