/**
 * Use case: built-in synthesizer note scheduling and parameter resolution.
 * Delegates to SynthModels for types/defaults.
 */

import { getTrackById } from '#/modules/Track/useCases/trackQueries';
import { type SynthParams, defaultSynthParams, type MpeParams } from '../models/SynthModels';

// Re-export model types for consumers
export { type SynthParams, defaultSynthParams, type MpeParams } from '../models/SynthModels';

const SYNTH_PARAM_KEYS: ReadonlyArray<keyof SynthParams> = [
    'waveform',
    'attack',
    'decay',
    'sustain',
    'release',
    'filterCutoff',
    'filterResonance',
    'filterType',
    'detune',
    'gain',
    'osc2Waveform',
    'osc2Detune',
    'osc2Mix',
    'subOscLevel',
    'noiseLevel',
];

const WAVEFORMS = new Set<string>(['sine', 'triangle', 'sawtooth', 'square']);
const FILTER_TYPES = new Set<string>(['lowpass', 'highpass', 'bandpass']);

const WAVEFORM_INDEX: Record<number, SynthParams['waveform']> = {
    0: 'sine',
    1: 'triangle',
    2: 'sawtooth',
    3: 'square',
};

const FILTER_TYPE_INDEX: Record<number, SynthParams['filterType']> = {
    0: 'lowpass',
    1: 'highpass',
    2: 'bandpass',
};

function resolveEnumParam<T extends string>(
    raw: number | string | undefined,
    allowed: Set<string>,
    indexMap: Record<number, T>,
    fallback: T
): T {
    if (raw === undefined) {
        return fallback;
    }
    if (typeof raw === 'string' && allowed.has(raw)) {
        return raw as T;
    }
    if (typeof raw === 'number' && indexMap[raw] !== undefined) {
        return indexMap[raw];
    }
    return fallback;
}

const MPE_BEND_RANGE_SEMITONES = 48;

export function scheduleNote(
    ctx: BaseAudioContext,
    destination: AudioNode,
    pitch: number,
    startTime: number,
    duration: number,
    velocity: number,
    params: SynthParams,
    mpe?: MpeParams
): OscillatorNode {
    const baseFrequency = 440 * 2 ** ((pitch - 69) / 12);
    const peakGain = (velocity / 127) * params.gain;
    const sustainLevel = peakGain * params.sustain;

    let frequency = baseFrequency;
    if (mpe?.pitchBend !== undefined) {
        const bendSemitones = (mpe.pitchBend / 8192) * MPE_BEND_RANGE_SEMITONES;
        frequency = baseFrequency * 2 ** (bendSemitones / 12);
    }

    // Mixer before filter
    const mixer = ctx.createGain();

    // -- Primary oscillator --
    const osc1 = ctx.createOscillator();
    osc1.type = params.waveform;
    osc1.frequency.setValueAtTime(frequency, startTime);
    osc1.detune.value = params.detune;
    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = params.osc2Mix > 0 ? 1 - params.osc2Mix : 1;
    osc1.connect(osc1Gain);
    osc1Gain.connect(mixer);

    // Track all nodes for cleanup
    const cleanupNodes: AudioNode[] = [osc1, osc1Gain, mixer];
    let osc2: OscillatorNode | null = null;
    let subOsc: OscillatorNode | null = null;

    // -- Second oscillator (if osc2Mix > 0) --
    if (params.osc2Mix > 0) {
        osc2 = ctx.createOscillator();
        osc2.type = params.osc2Waveform;
        osc2.frequency.setValueAtTime(frequency, startTime);
        osc2.detune.value = params.detune + params.osc2Detune;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = params.osc2Mix;
        osc2.connect(osc2Gain);
        osc2Gain.connect(mixer);
        cleanupNodes.push(osc2, osc2Gain);
    }

    // -- Sub-oscillator (one octave below, if subOscLevel > 0) --
    if (params.subOscLevel > 0) {
        subOsc = ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(frequency / 2, startTime);
        const subGain = ctx.createGain();
        subGain.gain.value = params.subOscLevel;
        subOsc.connect(subGain);
        subGain.connect(mixer);
        cleanupNodes.push(subOsc, subGain);
    }

    // -- Noise layer (if noiseLevel > 0) --
    let noiseSource: AudioBufferSourceNode | null = null;
    if (params.noiseLevel > 0) {
        const noiseDuration = duration + params.attack + params.decay + params.release + 0.1;
        const noiseLen = Math.ceil(ctx.sampleRate * noiseDuration);
        const noiseBuffer = new AudioBuffer({ numberOfChannels: 1, length: noiseLen, sampleRate: ctx.sampleRate });
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseLen; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = params.noiseLevel * 0.3; // scale noise to be subtle
        noiseSource.connect(noiseGain);
        noiseGain.connect(mixer);
        cleanupNodes.push(noiseGain);
    }

    // -- Filter --
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

    // -- Envelope --
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

    // -- Signal chain: mixer -> filter -> env -> destination --
    mixer.connect(filter);
    filter.connect(env);
    env.connect(destination);
    cleanupNodes.push(filter, env);

    // -- Start all sources --
    osc1.start(startTime);
    osc1.stop(releaseEnd + 0.01);
    if (osc2) {
        osc2.start(startTime);
        osc2.stop(releaseEnd + 0.01);
    }
    if (subOsc) {
        subOsc.start(startTime);
        subOsc.stop(releaseEnd + 0.01);
    }
    if (noiseSource) {
        noiseSource.start(startTime);
        noiseSource.stop(releaseEnd + 0.01);
    }

    osc1.onended = () => {
        for (const node of cleanupNodes) {
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        }
    };

    return osc1;
}

export function getSynthParamsForTrack(trackId: string): SynthParams {
    const track = getTrackById(trackId);
    if (!track) {
        return { ...defaultSynthParams };
    }

    const synthDevice = track.devices.find((d) => d.type === 'synth' || d.type === 'builtin-synth');
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

        if (key === 'waveform') {
            result.waveform = resolveEnumParam(raw, WAVEFORMS, WAVEFORM_INDEX, defaultSynthParams.waveform);
        } else if (key === 'filterType') {
            result.filterType = resolveEnumParam(raw, FILTER_TYPES, FILTER_TYPE_INDEX, defaultSynthParams.filterType);
        } else {
            (result as unknown as Record<string, number>)[key] = raw;
        }
    }

    return result;
}
